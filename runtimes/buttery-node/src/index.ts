import * as http from "http";
import connect from "connect";
import { EndpointBase, ButteryService, ButteryServerOptions } from "./types";
import { createRpcHandler } from "./rpc";
import { ChannelNode, RPCNode, ButteryNode } from "./shared/nodes";
import { createUpgradeHandler, ButterySocket } from "./channel";
import { isButteryPath } from "./util";
import {
  upgradeHandlerToResponseHandler,
  responseHandlerToUpgradeHandler,
  divertUpgrade,
} from "./shims";

type ExtractNodeType<P> = P extends ButteryNode<infer T> ? T : never;

export class ButteryServer {
  constructor(options: ButteryServerOptions = {}) {
    // will extend beyond one service, soon enough :)
    this.options = options;
    this.connectServer = connect();
  }

  private connectServer: connect.Server;
  private baseHandler:
    | ((req: http.IncomingMessage, res: http.ServerResponse) => unknown)
    | undefined;
  private options: ButteryServerOptions;

  private rpcImplementations: {
    [key: string]: {
      [key: string]: (
        request: any,
        httpRequest: http.IncomingMessage
      ) => Promise<any>;
    };
  } = {};

  private channelImplementations: {
    [key: string]: {
      [key: string]: (
        connection: any,
        httpRequest: http.IncomingMessage
      ) => void;
    };
  } = {};

  private serviceDefinitions: ButteryService<any>[] = [];

  wrapListener(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => unknown
  ) {
    this.baseHandler = handler;
  }

  use(middleware: connect.HandleFunction) {
    this.connectServer.use(middleware);
    return this;
  }

  implement<Endpoints extends EndpointBase, Z extends keyof Endpoints>(
    service: ButteryService<Endpoints>,
    name: Z,
    handler: Endpoints[Z] extends ChannelNode<any, any>
      ? (
          connection: ButterySocket<
            ExtractNodeType<Endpoints[Z]["incoming"]>,
            ExtractNodeType<Endpoints[Z]["outgoing"]>
          >,
          request: http.IncomingMessage
        ) => unknown
      : Endpoints[Z] extends RPCNode<any, any>
      ? (
          message: ExtractNodeType<Endpoints[Z]["request"]>,
          request: http.IncomingMessage
        ) => Promise<ExtractNodeType<Endpoints[Z]["response"]>>
      : never
  ) {
    // Register the service if it's not there yet
    if (this.serviceDefinitions.indexOf(service) < 0) {
      this.serviceDefinitions.push(service);
    }

    if (service.endpoints[name].type === "channelNode") {
      this.channelImplementations[service.name] =
        this.channelImplementations[service.name] || {};
      this.channelImplementations[service.name][name as any] = handler;
    } else if (service.endpoints[name].type === "rpcNode") {
      // Don't know why this cast is necessary
      this.rpcImplementations[service.name] =
        this.rpcImplementations[service.name] || {};
      this.rpcImplementations[service.name][name as any] = handler as (
        request: any,
        httpRequest: http.IncomingMessage
      ) => Promise<any>;
    } else {
      throw `Unknown rpc or channel ${name}`;
    }
  }

  rpcFallback = (
    next: (req: http.IncomingMessage, res: http.ServerResponse) => unknown
  ) => (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (!isButteryPath(req)) {
      if (this.baseHandler) {
        this.baseHandler(req, res);
        return;
      } else {
        res.statusCode = 404;
        res.end("Requested a non-buttery path without a base server specified");
        return;
      }
    }
    next(req, res);
  };

  createServer() {
    const server = http.createServer();

    const rpcHandler = createRpcHandler(
      this.serviceDefinitions,
      this.rpcImplementations,
      this.options
    );

    const upgradeHandler = createUpgradeHandler(
      this.serviceDefinitions,
      this.channelImplementations,
      this.options
    );

    this.connectServer.use(
      divertUpgrade(rpcHandler, upgradeHandlerToResponseHandler(upgradeHandler))
    );

    server.on("request", this.rpcFallback(this.connectServer));
    server.on(
      "upgrade",
      responseHandlerToUpgradeHandler(this.rpcFallback(this.connectServer))
    );

    return server;
  }

  listen(...args: any[]) {
    return this.createServer().listen(...args);
  }
}