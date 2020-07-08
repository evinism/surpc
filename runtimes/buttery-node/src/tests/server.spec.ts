import { PartyService } from "./fake_genfile.data";
import * as chai from "chai";
import { ButteryServer } from "..";
import express from "express";
import WebSocket from "ws";
import * as http from "http";

const baseApp = express();
baseApp.get("/", (req, res) => res.send({ status: "ok" }));

const request = require("supertest");

const expectCalledWithin = (
  fn: (...args: any[]) => void,
  timeout: number,
  done: (arg: any) => void
) => {
  let failed = false;
  const fail = () => {
    failed = true;
    done(new Error("Did not call value before " + timeout));
  };
  const interval = setTimeout(fail, timeout);
  return (...args: any[]) => {
    if (!failed) {
      clearTimeout(interval);
      fn(...args);
    }
  };
};

describe("ts-server runtime", function () {
  const butteryServer = new ButteryServer({
    rpc: { headers: { "Powered-By": "buttery" } },
    express: baseApp,
  });

  butteryServer.use(
    (req: http.IncomingMessage, res: http.ServerResponse, next: any) => {
      if (req.headers["failmeplz"]) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Fail!");
      } else {
        next();
      }
    }
  );

  butteryServer.use(
    PartyService,
    "AddToParty",
    (
      req: http.IncomingMessage & { mwAug?: "augmented" },
      res: http.ServerResponse,
      next: any
    ) => {
      req.mwAug = "augmented";
      next();
    }
  );
  butteryServer.implement(
    PartyService,
    "Chat",
    (connection, req: http.IncomingMessage & { mwAug?: "augmented" }) => {
      if (req.mwAug) {
        throw "Has augmentation for wrong wroute!";
      }
      connection.listen((msg) => {
        connection.send({
          time: msg.time,
          content: msg.content,
          author: {
            name: "you",
            pronouns: ["they", "them"],
          },
        });
      });
    }
  );
  butteryServer.implement(
    PartyService,
    "AddToParty",
    (_, req: http.IncomingMessage & { mwAug?: "augmented" }) => {
      if (!req.mwAug) {
        throw "Missing middleware augmentation for route!";
      }

      if (req.headers["genbadshape"]) {
        return Promise.resolve({
          success: true,
          time: {
            people: [],
            startTime: 0.5,
            endTime: 0,
          },
        });
      }

      return Promise.resolve({
        success: true,
        time: {
          people: [],
          startTime: 0,
          endTime: 0,
        },
      });
    }
  );
  const server: http.Server = butteryServer.createServer();

  describe("rpcs", () => {
    it("should accept preexisting urls", function (done) {
      request(server)
        .get("/")
        .end(function (err: any, res: any) {
          chai.assert.equal(err, null);
          chai.assert.deepEqual(res.body, { status: "ok" });
          chai.assert.equal(res.status, 200);
          done();
        });
    });

    it("should successfully reject invalid RPCs", function (done) {
      request(server)
        .post("/__buttery__/PartyService/AddToParty")
        .end(function (err: any, res: any) {
          chai.assert.equal(err, null);
          chai.assert.equal(res.status, 400);
          done();
        });
    });

    it("should successfully accept and handle valid RPCs", function (done) {
      request(server)
        .post("/__buttery__/PartyService/AddToParty")
        .send({ name: "john", pronouns: [] })
        .end(function (err: any, res: any) {
          chai.assert.equal(err, null);
          chai.assert.equal(res.status, 200);
          // Not sure why these don't reflect what actually happen on
          // an actual testbed
          //chai.assert.equal(res.headers["Content-Type"], "application/json");
          //chai.assert.equal(res.headers["Powered-By"], "buttery");

          chai.assert.deepEqual(res.body, {
            success: true,
            time: { people: [], startTime: 0, endTime: 0 },
          });
          done();
        });
    });
    it("should reject rpcs to channels", function (done) {
      request(server)
        .post("/__buttery__/PartyService/Chat")
        .send({})
        .end(function (err: any, res: any) {
          chai.assert.equal(err, null);
          chai.assert.equal(res.status, 501);
          done();
        });
    });
    it("should successfully reject RPCs failed by middleware", function (done) {
      request(server)
        .post("/__buttery__/PartyService/AddToParty")
        .set("failmeplz", "yus")
        .send({ name: "john", pronouns: [] })
        .end(function (err: any, res: any) {
          chai.assert.equal(err, null);
          chai.assert.equal(res.status, 500);
          done();
        });
    });
    it("should fail when the server passes an invalid response shape", function (done) {
      request(server)
        .post("/__buttery__/PartyService/AddToParty")
        .set("genbadshape", "yus")
        .send({ name: "john", pronouns: [] })
        .end(function (err: any, res: any) {
          chai.assert.equal(err, null);
          chai.assert.equal(res.status, 500);
          done();
        });
    });
  });

  describe("Channels", () => {
    let server: http.Server | undefined = undefined;

    before((done) => {
      server = butteryServer.listen(7575, () => {
        done();
      });
    });

    after((done) => {
      if (server) {
        server.on("close", () => {
          done();
        });

        server.close(() => {
          server && server.unref();
        });
      }
    });

    it.skip("should fail to connect to incorrect urls", function (done) {
      const socket = new WebSocket("ws://localhost:7575/__buttery__/bogus");
      socket.onerror = expectCalledWithin(
        (e) => {
          chai.assert.notEqual(e, null);
          done();
        },
        100,
        done
      );
    });

    it("should echo back requests", function (done) {
      const socket = new WebSocket(
        "ws://localhost:7575/__buttery__/PartyService/Chat"
      );
      const cleanup = () => {
        socket.close();
        done();
      };
      socket.on(
        "open",
        expectCalledWithin(
          () => {
            socket.send('{"time": 1, "content": "A Message!"}');
            socket.onmessage = expectCalledWithin(
              (msg: any) => {
                try {
                  chai.assert.deepEqual(JSON.parse(msg.data), {
                    time: 1,
                    content: "A Message!",
                    author: { name: "you", pronouns: ["they", "them"] },
                  });
                } catch (e) {
                  throw e;
                } finally {
                  cleanup();
                }
              },
              102,
              cleanup
            );
          },
          101,
          cleanup
        )
      );
    });
  });
});
