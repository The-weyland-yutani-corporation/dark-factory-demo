import {
  createConsoleLogger,
  getTracer,
  withSpan,
} from "@dark-factory/observability";
import {
  SpanStatusCode,
  trace,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createConsoleLogger", () => {
  it("emits structured records and respects the configured level", () => {
    const entries: string[] = [];
    const output = vi
      .spyOn(console, "log")
      .mockImplementation((entry: unknown) => {
        if (typeof entry === "string") {
          entries.push(entry);
        }
      });
    const logger = createConsoleLogger("test-service", {
      minimumLevel: "info",
      clock: () => new Date("2026-01-02T03:04:05.000Z"),
    });

    logger.debug("hidden");
    logger.info("ready", { instance: "one" });

    expect(output).toHaveBeenCalledTimes(1);
    expect(JSON.parse(entries[0] ?? "") as unknown).toEqual({
      timestamp: "2026-01-02T03:04:05.000Z",
      level: "info",
      service: "test-service",
      message: "ready",
      instance: "one",
    });
  });

  it("routes warning and error records to their severity outputs", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createConsoleLogger("test-service", {
      minimumLevel: "debug",
      clock: () => new Date("2026-01-02T03:04:05.000Z"),
    });

    logger.debug("debug");
    logger.warn("warning");
    logger.error("failure", { retryable: false });

    expect(warning).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('"retryable":false'),
    );
  });
});

describe("tracing helpers", () => {
  it("gets a named tracer from the global provider", () => {
    const tracer = {} as Tracer;
    const getTracerSpy = vi.spyOn(trace, "getTracer").mockReturnValue(tracer);

    expect(getTracer("worker")).toBe(tracer);
    expect(getTracerSpy).toHaveBeenCalledWith("worker");
  });

  it("ends successful spans and records failed operations", async () => {
    const end = vi.fn();
    const recordException = vi.fn();
    const setStatus = vi.fn();
    const span = { end, recordException, setStatus } as unknown as Span;
    const tracer = {
      startActiveSpan: vi.fn(
        (
          _name: string,
          _options: unknown,
          callback: (activeSpan: Span) => Promise<unknown>,
        ) => callback(span),
      ),
    } as unknown as Tracer;

    await expect(
      withSpan(tracer, "success", () => Promise.resolve("done"), {
        operation: "test",
      }),
    ).resolves.toBe("done");
    expect(setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    expect(end).toHaveBeenCalledOnce();

    const unavailable = new Error("unavailable");
    await expect(
      withSpan(tracer, "failure", () => Promise.reject(unavailable)),
    ).rejects.toBe(unavailable);
    expect(recordException).toHaveBeenCalledWith(unavailable);
    expect(setStatus).toHaveBeenLastCalledWith({
      code: SpanStatusCode.ERROR,
      message: "unavailable",
    });
    expect(end).toHaveBeenCalledTimes(2);

    await expect(
      withSpan(
        tracer,
        "non-error failure",
        // Deliberately verifies defensive handling of non-Error rejections.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        () => Promise.reject("offline"),
      ),
    ).rejects.toBe("offline");
    expect(recordException).toHaveBeenLastCalledWith(new Error("offline"));
    expect(setStatus).toHaveBeenLastCalledWith({
      code: SpanStatusCode.ERROR,
      message: "offline",
    });
  });
});
