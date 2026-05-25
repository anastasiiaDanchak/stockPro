const { NodeSDK } = require("@opentelemetry/sdk-node");
const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");

// Адреса Jaeger всередині Docker Compose
const exporter = new OTLPTraceExporter({
  url: "http://jaeger:4318/v1/traces"
});

// Ініціалізація SDK OpenTelemetry
const sdk = new NodeSDK({
  traceExporter: exporter,
  instrumentations: [getNodeAutoInstrumentations()]
});

// Старт трасування 
try {
  sdk.start();
  console.log("Tracing initialized");
} catch (err) {
  console.error("Error initializing tracing", err);
}

// Для коректного завершення при завершенні процесу Node.js
const shutdown = () => {
  try {
    sdk.shutdown();
    console.log("Tracing terminated");
  } catch (err) {
    console.error("Error terminating tracing", err);
  } finally {
    process.exit(0);
  }
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
