import { writeFile, mkdir } from "node:fs/promises";
import { z } from "zod";
import * as m from "../contracts/models";

const models = {
  DeletionSnapshot: m.DeletionSnapshot, DeleteRequest: m.DeleteRequest, DeleteResult: m.DeleteResult,
  Equipment: m.Equipment, Exercise: m.Exercise, Week: m.Week, Workout: m.Workout,
  Session: m.Session, Ledger: m.Ledger, Previous: m.Previous, PreviousBatch: m.PreviousBatch, ApiKeyInfo: m.ApiKeyInfo,
  Change: m.Change, ImportManifest: m.ImportManifest, Error: m.ErrorResponse,
  TrainingDefaults: m.TrainingDefaults, TimerSettings: m.TimerSettings, Catalog: m.Catalog,
  NotificationConfig: m.NotificationConfig, NotificationSubscription: m.NotificationSubscription,
  NotificationDeviceInput: m.NotificationDeviceInput, NotificationDeviceStatus: m.NotificationDeviceStatus,
  NotificationDeviceId: m.NotificationDeviceId, TimerAlertInput: m.TimerAlertInput, TimerAlertStatus: m.TimerAlertStatus,
};
type Schema = Record<string, unknown>;
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const array = (name: string) => ({ type: "array", items: ref(name) });
const object = (properties: Schema) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: "string" };
const parameter = (name: string, location = "query", required = false) =>
  ({ name, in: location, required, schema: string });
const response = (schema: Schema) => ({ description: "Success", content: { "application/json": { schema } } });
const paths: Record<string, Record<string, unknown>> = {};
function operation(method: string, path: string, schema: Schema, body?: Schema, parameters: unknown[] = [], options: { sessionOnly?: boolean; idempotency?: boolean; success?: number } = {}) {
  const mutates = method !== "get";
  paths[path] ??= {};
  paths[path][method] = {
    operationId: `${method}_${path.replace(/[^a-z0-9]/gi, "_")}`,
    security: options.sessionOnly ? [{ session: [] }] : [{ session: [] }, { apiKey: [] }],
    parameters: [...parameters, ...(mutates && options.idempotency !== false ? [parameter("Idempotency-Key", "header", true)] : [])],
    ...(body ? { requestBody: { required: true, content: { "application/json": { schema: body } } } } : {}),
    responses: { [options.success ?? (method === "post" && !path.endsWith("/import") ? 201 : 200)]: response(schema),
      ...Object.fromEntries([400,401,403,404,409,413,422,429,500,503].map(s => [s, { ...response(ref("Error")), description: "Request failed" }])) },
  };
}
for (const resource of ["workouts", "sessions"]) {
  operation("get", `/api/v1/${resource}/{id}/deletion`, ref("DeletionSnapshot"), undefined, [parameter("id", "path", true)]);
  operation("delete", `/api/v1/${resource}/{id}`, ref("DeleteResult"), ref("DeleteRequest"), [parameter("id", "path", true)]);
}
for (const [resource, name] of Object.entries({ equipment: "Equipment", exercises: "Exercise", weeks: "Week", workouts: "Workout", sessions: "Session" })) {
  const path = `/api/v1/${resource}`;
  operation("get", path, array(name), undefined, resource === "workouts" ? [parameter("weekId"), parameter("kind")] : resource === "sessions" ? [parameter("weekId"), parameter("workoutId")] : []);
  operation("post", path, ref(name), object({ value: ref(name) }));
  operation("get", `${path}/{id}`, ref(name), undefined, [parameter("id", "path", true)]);
  operation("put", `${path}/{id}`, ref(name), object({ expectedRevision: { type: "integer", minimum: 0 }, value: ref(name) }), [parameter("id", "path", true)]);
}
operation("get", "/api/v1/me", object({ id: string, name: string, email: string }));
operation("get", "/api/v1/timer-settings", ref("TimerSettings"));
operation("put", "/api/v1/timer-settings", ref("TimerSettings"), object({ expectedRevision: { type: "integer", minimum: 0 }, value: ref("TimerSettings") }));
const notificationOptions = { sessionOnly: true, idempotency: false, success: 200 };
operation("get", "/api/v1/notification-config", ref("NotificationConfig"), undefined, [], notificationOptions);
operation("get", "/api/v1/notification-device", ref("NotificationDeviceStatus"), undefined, [parameter("deviceId", "query", true)], notificationOptions);
operation("put", "/api/v1/notification-device", ref("NotificationDeviceStatus"), ref("NotificationDeviceInput"), [], notificationOptions);
operation("delete", "/api/v1/notification-device", ref("NotificationDeviceStatus"), ref("NotificationDeviceId"), [], notificationOptions);
operation("post", "/api/v1/notification-test", object({ sent: { const: true, type: "boolean" } }), ref("NotificationDeviceId"), [], notificationOptions);
operation("put", "/api/v1/timer-alerts", ref("TimerAlertStatus"), ref("TimerAlertInput"), [], notificationOptions);
operation("get", "/api/v1/training-defaults", ref("TrainingDefaults"));
operation("put", "/api/v1/training-defaults", ref("TrainingDefaults"), object({
  expectedRevision: { type: "integer", minimum: 0 }, value: ref("TrainingDefaults"),
}));
operation("get", "/api/v1/catalog", ref("Catalog"));
operation("post", "/api/v1/weeks/{id}/copy", ref("Week"), object({ startDate: { ...string, format: "date" } }), [parameter("id", "path", true)]);
operation("post", "/api/v1/workouts/{id}/start", ref("Session"), object({ performedOn: { ...string, format: "date" } }), [parameter("id", "path", true)]);
operation("get", "/api/v1/history", ref("Previous"), undefined, [parameter("exerciseId", "query", true), parameter("routineId"), parameter("before", "query", true)]);
operation("get", "/api/v1/history/batch", ref("PreviousBatch"), undefined, [
  { name: "exerciseId", in: "query", required: true, style: "form", explode: true, schema: { type: "array", minItems: 1, maxItems: 100, items: { type: "string", format: "uuid" } } },
  parameter("routineId"), parameter("before", "query", true),
]);
operation("get", "/api/v1/ledger", ref("Ledger"), undefined, [parameter("weekId", "query", true)]);
operation("get", "/api/v1/changes", array("Change"));
operation("get", "/api/v1/keys", array("ApiKeyInfo"));
operation("post", "/api/v1/keys", object({ key: string, info: ref("ApiKeyInfo") }), object({ name: string, scopes: { type: "array", items: { type: "string", enum: m.Scope.options } } }));
operation("delete", "/api/v1/keys/{id}", object({ ok: { type: "boolean" } }), undefined, [parameter("id", "path", true)]);
operation("get", "/api/v1/export", ref("ImportManifest"), undefined, [parameter("format")]);
operation("post", "/api/v1/import", { type: "object", additionalProperties: true }, object({ manifest: ref("ImportManifest") }));
const document = {
  openapi: "3.1.0", info: { title: "Training Platform", version: "1.0.0", description: "Owner-scoped workout API. Training writes require Idempotency-Key. Notification routes require a browser session and use per-device desired state with a monotonic timer sequence. Update conflicts return 409 with error.details.current. API key scopes: read, plans:write, results:write, library:write. Keys and import require a browser session." },
  servers: [{ url: "/" }], paths,
  components: {
    securitySchemes: { session: { type: "apiKey", in: "cookie", name: "better-auth.session_token" }, apiKey: { type: "http", scheme: "bearer" } },
    schemas: Object.fromEntries(Object.entries(models).map(([name, schema]) => {
      const json = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" });
      delete json.$schema;
      return [name, json];
    })),
  },
};
await mkdir("public", { recursive: true });
await writeFile("public/openapi.json", JSON.stringify(document, null, 2) + "\n");
console.log("Generated public/openapi.json");
