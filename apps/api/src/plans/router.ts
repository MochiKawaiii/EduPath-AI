import { createHash } from "node:crypto";
import { Router, raw, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import { requireAdminAccess } from "../middleware/authorization.js";
import { PlanError, itemSchema } from "./model.js";
import { parsePlan } from "./parser.js";
import { PlanRepository } from "./repository.js";

const fingerprint = (data: unknown) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
const uuid = z.string().uuid();
const metadata = z
  .object({
    name: z.string().trim().min(1).max(500),
    totalCredits: z.number().min(0).max(400).nullable(),
    notes: z.string().trim().max(12000),
  })
  .strict();
const editableItem = itemSchema
  .omit({
    position: true,
    sourceRow: true,
    sourceSheet: true,
    sourceCells: true,
    id: true,
  })
  .strict();
export function createPlansRouter(
  pool: DatabasePool | undefined,
  webOrigin: string,
) {
  const router = Router(),
    repository = pool ? new PlanRepository(pool) : null;
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use(requireAdminAccess);
  router.use(async (req, res, next) => {
    if (!repository) {
      res.status(503).json({ error: "database_required" });
      return;
    }
    const write = !["GET", "HEAD"].includes(req.method);
    if (write && req.get("origin") !== webOrigin) {
      res.status(403).json({ error: "invalid_origin" });
      return;
    }
    await repository.access(req.session.user!, write);
    next();
  });
  router.get("/", async (req, res) => {
    const query = z
      .object({
        q: z.string().max(300).default(""),
        cohort: z
          .string()
          .regex(/^K\d+$|^$/)
          .default(""),
        active: z.enum(["", "true", "false"]).default(""),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .parse(req.query);
    res.json(
      await repository!.list(query.q, query.cohort, query.active, query.page),
    );
  });
  const upload = raw({
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    limit: "5mb",
  });
  const file = (body: unknown) => {
    if (!Buffer.isBuffer(body)) throw new PlanError("invalid_workbook");
    return body;
  };
  const filename = (header: string | undefined) => {
    let name = "ke-hoach.xlsx";
    try {
      name = decodeURIComponent(header ?? name);
    } catch {
      throw new PlanError("invalid_filename");
    }
    if (
      !/\.xlsx$/i.test(name) ||
      name.length > 240 ||
      /[\x00-\x1f/\\]/.test(name)
    )
      throw new PlanError("invalid_filename");
    return name;
  };
  async function prepare(body: unknown) {
    return repository!.link(await parsePlan(file(body)));
  }
  function confirmed(req: import("express").Request, data: unknown) {
    if (req.get("x-preview-hash") !== fingerprint(data))
      throw new PlanError("preview_changed", 409);
  }
  router.post("/preview", upload, async (req, res) => {
    const data = await prepare(req.body);
    res.json({ data, previewHash: fingerprint(data) });
  });
  router.post("/", upload, async (req, res) => {
    const buffer = file(req.body),
      data = await prepare(buffer);
    confirmed(req, data);
    if (data.warnings.length && req.get("x-confirm-warnings") !== "true")
      throw new PlanError("review_warnings");
    const id = await repository!.create(
      data,
      buffer,
      filename(req.get("x-filename")),
      req.session.user!,
    );
    res.status(201).json(await repository!.detail(id));
  });
  router.get("/:id", async (req, res) =>
    res.json(
      await repository!.detail(
        uuid.parse(req.params.id),
        req.query.revision ? uuid.parse(req.query.revision) : undefined,
      ),
    ),
  );
  router.get("/:id/source/:revision", async (req, res) => {
    const buffer = await repository!.source(
      uuid.parse(req.params.id),
      uuid.parse(req.params.revision),
    );
    res
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .attachment("ke-hoach-goc.xlsx")
      .send(buffer);
  });
  router.put("/:id/import", upload, async (req, res) => {
    const id = uuid.parse(req.params.id),
      token = uuid.parse(req.get("x-version")),
      buffer = file(req.body),
      data = await prepare(buffer);
    confirmed(req, data);
    if (data.warnings.length && req.get("x-confirm-warnings") !== "true")
      throw new PlanError("review_warnings");
    res.json(
      await repository!.update(
        id,
        token,
        req.session.user!,
        () => data,
        "Cập nhật từ Excel",
        { file: buffer, filename: filename(req.get("x-filename")) },
      ),
    );
  });
  router.patch("/:id", async (req, res) => {
    const change = metadata.parse(req.body);
    res.json(
      await repository!.update(
        uuid.parse(req.params.id),
        uuid.parse(req.get("x-version")),
        req.session.user!,
        (data) => ({ ...data, ...change }),
        "Cập nhật thông tin kế hoạch",
      ),
    );
  });
  router.patch("/:id/items/:itemId", async (req, res) => {
    const change = editableItem.parse(req.body),
      itemId = z
        .string()
        .regex(/^row-\d+$/)
        .parse(req.params.itemId);
    res.json(
      await repository!.update(
        uuid.parse(req.params.id),
        uuid.parse(req.get("x-version")),
        req.session.user!,
        (data) => {
          const index = data.items.findIndex((c) => c.id === itemId);
          if (index < 0) throw new PlanError("not_found", 404);
          data.items[index] = { ...data.items[index]!, ...change };
          return data;
        },
        `Cập nhật phân bổ ${itemId}`,
      ),
    );
  });
  router.patch("/:id/status", async (req, res) => {
    const change = z.object({ isActive: z.boolean() }).strict().parse(req.body);
    res.json(
      await repository!.update(
        uuid.parse(req.params.id),
        uuid.parse(req.get("x-version")),
        req.session.user!,
        (d) => d,
        "",
        undefined,
        change.isActive,
      ),
    );
  });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof PlanError) {
      res
        .status(error.status)
        .json({ error: error.code, details: error.details });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "invalid_plan_input",
        details: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
      return;
    }
    if (error.type === "entity.too.large") {
      res.status(413).json({ error: "workbook_too_large" });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
