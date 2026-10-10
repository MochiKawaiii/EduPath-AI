import { Router, raw, type ErrorRequestHandler, type Request } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import { requireAdminAccess } from "../middleware/authorization.js";
import { CareerError } from "../careers/shared.js";
import { courseCode } from "../curricula/course-codes.js";
import { CompetencyError, configurationInput, groupInput, skillInput } from "./model.js";
import { CompetencyRepository } from "./repository.js";
import { parseCompetencyWorkbook } from "./workbook.js";
import { applyCompetencyImport, previewCompetencyImport } from "./import.js";

const uuid = z.uuid();
const emptyQuery = z.object({}).strict();
const confirmed = z.object({ confirmed: z.literal(true) }).strict();
const skillChange = skillInput.omit({ existingSkillId: true });
const upload = raw({ type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", limit: "5mb" });

export function createCompetenciesRouter(pool: DatabasePool | undefined, webOrigin: string) {
  const router = Router();
  const repository = pool ? new CompetencyRepository(pool) : null;
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.use(requireAdminAccess);
  router.use(async (req, res, next) => {
    if (!repository) { res.status(503).json({ error: "database_required" }); return; }
    if (!["GET", "HEAD"].includes(req.method) && req.get("origin") !== webOrigin) {
      res.status(403).json({ error: "invalid_origin" }); return;
    }
    await repository.access(req.session.user!);
    next();
  });

  router.get("/groups", async (req, res) => {
    emptyQuery.parse(req.query);
    res.json({ items: await repository!.groups() });
  });
  router.get("/groups/:id", async (req, res) => {
    emptyQuery.parse(req.query);
    res.json(await repository!.group(uuid.parse(req.params.id)));
  });
  router.post("/groups", async (req, res) => {
    res.status(201).json(await repository!.createGroup(groupInput.parse(req.body), req.session.user!));
  });
  router.patch("/groups/:id", async (req, res) => {
    res.json(await repository!.updateGroup(uuid.parse(req.params.id), uuid.parse(req.get("x-version")),
      groupInput.parse(req.body), req.session.user!));
  });

  router.get("/catalog", async (req, res) => {
    emptyQuery.parse(req.query);
    res.json({ items: await repository!.catalog() });
  });
  router.get("/skills", async (req, res) => {
    const query = z.object({ q: z.string().trim().max(300).default(""),
      groupId: z.union([z.literal(""), uuid]).default(""), active: z.enum(["", "true", "false"]).default("") }).strict().parse(req.query);
    res.json({ items: await repository!.skills(query) });
  });
  router.get("/skills/:id", async (req, res) => {
    emptyQuery.parse(req.query);
    res.json(await repository!.skill(uuid.parse(req.params.id)));
  });
  router.post("/skills", async (req, res) => {
    res.status(201).json(await repository!.createSkill(skillInput.parse(req.body), req.session.user!));
  });
  router.patch("/skills/:id", async (req, res) => {
    res.json(await repository!.updateSkill(uuid.parse(req.params.id), uuid.parse(req.get("x-version")),
      skillChange.parse(req.body), req.session.user!));
  });
  router.delete("/skills/:id", async (req, res) => {
    const id = uuid.parse(req.params.id), version = uuid.parse(req.get("x-version"));
    confirmed.parse(req.body);
    res.json(await repository!.deleteSkill(id, version, req.session.user!));
  });

  router.get("/curricula", async (req, res) => {
    emptyQuery.parse(req.query);
    res.json({ items: await repository!.curricula() });
  });
  router.get("/courses", async (req, res) => {
    const query = z.object({ revisionId: uuid, q: z.string().trim().max(300).default(""),
      status: z.enum(["", "missing", "draft", "active", "archived"]).default("") }).strict().parse(req.query);
    res.json({ items: await repository!.courses(query.revisionId, query) });
  });
  router.get("/courses/:revisionId/:code", async (req, res) => {
    emptyQuery.parse(req.query);
    res.json(await repository!.course(uuid.parse(req.params.revisionId), courseCode.parse(req.params.code)));
  });
  router.put("/courses/:revisionId/:code", async (req, res) => {
    const version = z.union([z.literal("new"), uuid]).parse(req.get("x-version"));
    res.json(await repository!.saveCourse(uuid.parse(req.params.revisionId), courseCode.parse(req.params.code), version,
      configurationInput.parse(req.body), req.session.user!));
  });
  router.delete("/courses/:revisionId/:code", async (req, res) => {
    const revisionId = uuid.parse(req.params.revisionId), code = courseCode.parse(req.params.code), version = uuid.parse(req.get("x-version"));
    confirmed.parse(req.body);
    res.json(await repository!.archiveCourse(revisionId, code, version, req.session.user!));
  });
  router.get("/summary", async (req, res) => {
    const query = z.object({ revisionId: uuid }).strict().parse(req.query);
    res.json(await repository!.summary(query.revisionId));
  });

  const importSource = (req: Request) => {
    const revisionId = uuid.parse(req.get("x-revision-id"));
    const cohortCode = z.string().regex(/^K\d+$/).parse(req.get("x-source-cohort"));
    if (!Buffer.isBuffer(req.body)) throw new CompetencyError("invalid_workbook", 400);
    let filename: string;
    try { filename = decodeURIComponent(req.get("x-filename") ?? "competencies.xlsx"); }
    catch { throw new CompetencyError("invalid_filename", 400); }
    if (!/\.xlsx$/i.test(filename) || filename.length > 240 || /[\x00-\x1f\x7f/\\]/.test(filename))
      throw new CompetencyError("invalid_filename", 400);
    return { revisionId, cohortCode, filename, buffer: req.body };
  };
  router.post("/import/preview", upload, async (req, res) => {
    const source = importSource(req);
    const data = await parseCompetencyWorkbook(source.buffer);
    res.json(await previewCompetencyImport(pool!, data, source));
  });
  router.post("/import", upload, async (req, res) => {
    const source = importSource(req);
    const token = z.string().min(1).max(200).parse(req.get("x-preview-token"));
    const data = await parseCompetencyWorkbook(source.buffer);
    res.json(await applyCompetencyImport(pool!, data, { ...source, token,
      confirmWarnings: req.get("x-confirm-warnings") === "true", confirmOverwrite: req.get("x-confirm-overwrite") === "true" }, req.session.user!));
  });

  const errors: ErrorRequestHandler = (error, req, res, next) => {
    if (error instanceof CompetencyError) { res.status(error.status).json({ error: error.code, details: error.details }); return; }
    if (error instanceof CareerError) { res.status(error.status).json({ error: error.code }); return; }
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: ["GET", "HEAD"].includes(req.method) ? "invalid_competency_query" : "invalid_competency_input",
        details: error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`) });
      return;
    }
    const databaseError = error as { type?: string; code?: string; constraint?: string; message?: string };
    if (databaseError.type === "entity.too.large") {
      res.status(413).json({ error: req.path.startsWith("/import") ? "workbook_too_large" : "competency_input_too_large" }); return;
    }
    if (databaseError.code === "23505") {
      res.status(409).json({ error: req.path.startsWith("/groups") ? "group_exists" :
        req.path.startsWith("/skills") ? (["competency_skills_pkey", "ad_comp_skills_pkey"].includes(databaseError.constraint ?? "") ? "skill_profile_exists" : "skill_exists") : "configuration_exists" });
      return;
    }
    if (databaseError.code === "23514") {
      const constraint = databaseError.constraint;
      if (constraint === "competency_active_total") { res.status(422).json({ error: "weight_total_invalid" }); return; }
      if (constraint === "competency_active_skills") {
        res.status(409).json({ error: req.path.startsWith("/groups") ? "group_in_use" :
          req.path.startsWith("/skills") ? "skill_in_use" : "skill_unavailable" }); return;
      }
      if (constraint === "competency_scope_immutable") { res.status(409).json({ error: "configuration_scope_immutable" }); return; }
    }
    if (databaseError.code === "23503") { res.status(409).json({ error: "invalid_competency_reference" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
