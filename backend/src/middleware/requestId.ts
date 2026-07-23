import { NextFunction, Request, Response } from "express";
import { nanoid } from "nanoid";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

// Every request gets a correlation ID: accept one from an upstream proxy
// (X-Request-Id) or mint a new one. Echoed back on the response so a client
// can quote it in a bug report, and attached to every log line for the
// lifetime of the request.
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id");
  req.requestId = incoming && incoming.length <= 128 ? incoming : nanoid();
  res.setHeader("x-request-id", req.requestId);
  next();
}
