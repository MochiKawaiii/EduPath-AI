import { createHash } from "node:crypto";
import { Router, raw, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import { requireAdminAccess } from "../middleware/authorization.js";
import { GraduationError, identity, validateData, warnings } from "./model.js";
import { parseGraduation } from "./parser.js";
import { GraduationRepository } from "./repository.js";
const uuid = z.string().uuid();
const fingerprint = (data: unknown) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
export function createGraduationRouter(
  pool: DatabasePool | undefined,
  origin: string,
) {
  const router = Router(),
    repository = pool ? new GraduationRepository(pool) : null;
  router.use(requireAdminAccess);
  router.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!repository) {
      res.status(503).json({ error: "database_required" });
      return;
    }
    const write = !["GET", "HEAD"].includes(req.method);
    if (write && req.get("origin") !== origin) {
      res.status(403).json({ error: "invalid_origin" });
      return;
    }
    await repository.access(req.session.user!, write);
    next();
  });
  router.get("/", async (req, res) => {
    const q = z
      .object({
        q: z.string().max(300).default(""),
        cohort: z.string().max(10).default(""),
        active: z.enum(["", "true", "false"]).default(""),
      })
      .strict()
      .parse(req.query);
    res.json(await repository!.list(q.q, q.cohort, q.active));
  });
  const upload = raw({ type: "application/octet-stream", limit: "5mb" });
  const name = (header: string | undefined) => {
    let n = "tieu-chuan.xlsx";
    try {
      n = decodeURIComponent(header ?? n);
    } catch {
      throw new GraduationError("invalid_filename");
    }
    if (
      !/\.(xlsx?|zip)$/i.test(n) ||
      n.length > 240 ||
      /[\x00-\x1f/\\]/.test(n)
    )
      throw new GraduationError("invalid_filename");
    return n;
  };
  const file = (body: unknown) => {
    if (!Buffer.isBuffer(body)) throw new GraduationError("invalid_workbook");
    return body;
  };
  router.post("/preview", upload, async (req, res) => {
    const data = await parseGraduation(
      file(req.body),
      name(req.get("x-filename")),
    );
    const existing = await pool!.query(
      "SELECT id,identity_key FROM graduation_standards WHERE identity_key=ANY($1::text[])",
      [data.map(identity)],
    );
    res.json({
      fingerprint: fingerprint(data),
      items: data.map((d, index) => ({
        index,
        key: identity(d),
        data: d,
        warnings: warnings(d),
        existingId:
          existing.rows.find((r) => r.identity_key === identity(d))?.id ?? null,
      })),
    });
  });
  router.post("/import", upload, async (req, res) => {
    const filename = name(req.get("x-filename")),
      data = await parseGraduation(file(req.body), filename);
    if (req.get("x-preview") !== fingerprint(data))
      throw new GraduationError("preview_required", 409);
    let indexes: unknown;
    try {
      indexes = JSON.parse(req.get("x-selection") ?? "[]");
    } catch {
      throw new GraduationError("invalid_selection");
    }
    const selected = z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(data.length - 1),
      )
      .min(1)
      .max(50)
      .parse(indexes);
    if (new Set(selected).size !== selected.length)
      throw new GraduationError("invalid_selection");
    res.status(201).json({
      ids: await repository!.createBatch(
        selected.map((i) => data[i]!),
        file(req.body),
        filename,
        req.session.user!,
      ),
    });
  });
  router.get("/:id", async (req, res) => {
    const q = z.object({ revision: uuid.optional() }).strict().parse(req.query);
    res.json(await repository!.detail(uuid.parse(req.params.id), q.revision));
  });
  router.get("/:id/source/:revision", async (req, res) => {
    const s = await repository!.source(
      uuid.parse(req.params.id),
      uuid.parse(req.params.revision),
    );
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="graduation-source"; filename*=UTF-8''${encodeURIComponent(s.source_filename)}`,
    );
    res.send(s.source_data);
  });
  router.patch("/:id", async (req, res) =>
    res.json(
      await repository!.update(
        uuid.parse(req.params.id),
        uuid.parse(req.get("x-version")),
        req.session.user!,
        { data: validateData(req.body) },
      ),
    ),
  );
  router.patch("/:id/status", async (req, res) => {
    const body = z.object({ isActive: z.boolean() }).strict().parse(req.body);
    res.json(
      await repository!.update(
        uuid.parse(req.params.id),
        uuid.parse(req.get("x-version")),
        req.session.user!,
        body,
      ),
    );
  });
  router.post("/:id/replace", upload, async (req, res) => {
    const filename = name(req.get("x-filename")),
      data = await parseGraduation(file(req.body), filename);
    if (req.get("x-preview") !== fingerprint(data))
      throw new GraduationError("preview_required", 409);
    const index = z.coerce
      .number()
      .int()
      .min(0)
      .max(data.length - 1)
      .parse(req.get("x-sheet"));
    res.json(
      await repository!.update(
        uuid.parse(req.params.id),
        uuid.parse(req.get("x-version")),
        req.session.user!,
        { data: data[index]!, replacement: { file: file(req.body), filename } },
      ),
    );
  });
  const errors: ErrorRequestHandler = (e, _req, res, next) => {
    if (e instanceof GraduationError) {
      res.status(e.status).json({ error: e.code, details: e.details });
      return;
    }
    if (
      e instanceof z.ZodError ||
      e.message === "invalid_graduation_structure"
    ) {
      res.status(400).json({ error: "invalid_graduation_input" });
      return;
    }
    if (e.type === "entity.too.large") {
      res.status(413).json({ error: "workbook_too_large" });
      return;
    }
    next(e);
  };
  router.use(errors);
  return router;
}
