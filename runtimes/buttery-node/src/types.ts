import * as http from "http";
import { RPCNode, ChannelNode } from "./shared/nodes";
import express from "express";

export type EndpointBase = {
  [key: string]: RPCNode<any, any> | ChannelNode<any, any>;
};

export interface ButteryService<Endpoints extends EndpointBase> {
  name: string;
  endpoints: Endpoints;
}

export interface ButteryServerOptions {
  rpc?: {
    headers?: { [key: string]: string };
  };
  baseHandler?: (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) => unknown;
  express?: express.Express;
}

export type ImplementationMap = {
  [key: string]: {
    [key: string]: (connection: any, httpRequest: http.IncomingMessage) => void;
  };
};
