import { writeFile, mkdir } from "node:fs/promises";
import { z } from "zod";
import * as m from "../contracts/models";

const models = {
  Equipment: m.Equipment, Exercise: m.Exercise, Week: m.Week, Workout: m.Workout,
  Session: m.Session, Ledger: m.Ledger, Previous: m.Previous, ApiKeyInfo: m.ApiKeyInfo,
  Change: m.Change, ImportManifest: m.ImportManifest, Error: m.ErrorResponse,
  TrainingDefaults: m.TrainingDefaults, TimerSettings: m.TimerSettings, Catalog: m.Catalog,
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
function operation(method: string, path: string, schema: Schema, body?: Schema, parameters: unknown[] = []) {
  const mutates = method !== "get";
  paths[path] ??= {};
  paths[path][method] = {
    operationId: `${method}_${path.replace(/[^a-z0-9]/gi, "_")}`,
    security: [{ session: [] }, { apiKey: [] }],
    parameters: [...parameters, ...(mutates ? [parameter("Idempotency-Key", "header", true)] : [])],
    ...(body ? { requestBody: { required: true, content: { "application/json": { schema: body } } } } : {}),
    responses: { [method === "post" && !path.endsWith("/import") ? "201" : "200"]: response(schema),
      ...Object.fromEntries([400,401,403,404,409,413,422,429,500,503].map(s => [s, { ...response(ref("Error")), description: "Request failed" }])) },
  };
}
for (const [resource, name] of Object.entries({ equipment: "Equipment", exercises: "Exercise", weeks: "Week", workouts: "Workout", sessions: "Session" })) {
  const path = `/api/v1/${resource}`;
  operation("get", path, array(name), undefined, resource === "workouts" ? [parameter("weekId"), parameter("kind")] : resource === "sessions" ? [parameter("weekId")] : []);
  operation("post", path, ref(name), object({ value: ref(name) }));
  operation("get", `${path}/{id}`, ref(name), undefined, [parameter("id", "path", true)]);
  operation("put", `${path}/{id}`, ref(name), object({ expectedRevision: { type: "integer", minimum: 0 }, value: ref(name) }), [parameter("id", "path", true)]);
}
operation("get", "/api/v1/me", object({ id: string, name: string, email: string }));
operation("get", "/api/v1/timer-settings", ref("TimerSettings"));
operation("put", "/api/v1/timer-settings", ref("TimerSettings"), object({ expectedRevision: { type: "integer", minimum: 0 }, value: ref("TimerSettings") }));
operation("get", "/api/v1/training-defaults", ref("TrainingDefaults"));
operation("put", "/api/v1/training-defaults", ref("TrainingDefaults"), object({
  expectedRevision: { type: "integer", minimum: 0 }, value: ref("TrainingDefaults"),
}));
operation("get", "/api/v1/catalog", ref("Catalog"));
operation("post", "/api/v1/weeks/{id}/copy", ref("Week"), object({ startDate: { ...string, format: "date" } }), [parameter("id", "path", true)]);
operation("post", "/api/v1/workouts/{id}/start", ref("Session"), object({ performedOn: { ...string, format: "date" } }), [parameter("id", "path", true)]);
operation("get", "/api/v1/history", ref("Previous"), undefined, [parameter("exerciseId", "query", true), parameter("routineId"), parameter("before", "query", true)]);
operation("get", "/api/v1/ledger", ref("Ledger"), undefined, [parameter("weekId", "query", true)]);
operation("get", "/api/v1/changes", array("Change"));
operation("get", "/api/v1/keys", array("ApiKeyInfo"));
operation("post", "/api/v1/keys", object({ key: string, info: ref("ApiKeyInfo") }), object({ name: string, scopes: { type: "array", items: { type: "string", enum: m.Scope.options } } }));
operation("delete", "/api/v1/keys/{id}", object({ ok: { type: "boolean" } }), undefined, [parameter("id", "path", true)]);
operation("get", "/api/v1/export", ref("ImportManifest"), undefined, [parameter("format")]);
operation("post", "/api/v1/import", { type: "object", additionalProperties: true }, object({ manifest: ref("ImportManifest") }));
const document = {
  openapi: "3.1.0", info: { title: "Training Platform", version: "1.0.0", description: "Owner-scoped workout API. Writes require Idempotency-Key. Update conflicts return 409 with error.details.current. API key scopes: read, plans:write, results:write, library:write. Keys and import require a browser session." },
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
