import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "./student-icons";
import {
  careerCategories,
  type Career,
  type CareerSelection,
} from "./career-types";
import "./student-records.css";
export type EditableStudentProfile = {
  className: string | null;
  interests: string | null;
  careerGoal: string | null;
  careerPositionId?: string | null;
  careerPosition?: CareerSelection | null;
};
export default function StudentProfileEditor({
  profile,
  onSaved,
}: {
  profile: EditableStudentProfile;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState({
      interests: "",
      careerPositionId: "",
    });
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [careers, setCareers] = useState<Career[]>([]),
    [careerLoading, setCareerLoading] = useState(false),
    [careerError, setCareerError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!editing)
      setDraft({
        interests: profile.interests ?? "",
        careerPositionId: profile.careerPositionId ?? "",
      });
  }, [profile, editing]);
  useEffect(() => {
    if (!editing) return;
    const controller = new AbortController();
    setCareerLoading(true);
    setCareerError("");
    void fetch("/api/student/careers", {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok)
          throw new Error("Chưa tải được danh sách vị trí nghề nghiệp.");
        return res.json() as Promise<{ items: Career[] }>;
      })
      .then((data) => {
        if (!controller.signal.aborted) setCareers(data.items);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setCareerError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCareerLoading(false);
      });
    return () => controller.abort();
  }, [editing, retry]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/student/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          careerPositionId: draft.careerPositionId || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error === "career_unavailable"
            ? "Vị trí vừa bị xóa khỏi danh mục. Hãy chọn vị trí khác hoặc bỏ chọn."
            : res.status === 401
              ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
              : res.status === 400
                ? "Thông tin chưa hợp lệ. Sở thích tối đa 2.000 ký tự."
                : "Không lưu được hồ sơ. Vui lòng thử lại.",
        );
      }
      setMessage("Đã cập nhật thông tin cá nhân.");
      setEditing(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="sw-panel sr-editor">
      <div className="sw-section-heading">
        <h2>Thông tin cá nhân</h2>
        {!editing && (
          <button
            className="sw-text-link"
            onClick={() => {
              setEditing(true);
              setMessage("");
              setError("");
            }}
          >
            <Icon name="edit" />
            Chỉnh sửa thông tin
          </button>
        )}
      </div>
      {message && (
        <p className="sr-success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="sr-error" role="alert">
          {error}
        </p>
      )}
      {editing ? (
        <form onSubmit={(e) => void save(e)}>
          <fieldset disabled={busy} className="sr-form-fields">
            <label>Lớp học<input value={profile.className ?? "Chưa cập nhật"} readOnly /></label>
            <label className="sr-wide">
              Vị trí nghề nghiệp mong muốn
              <select
                value={draft.careerPositionId}
                disabled={careerLoading || Boolean(careerError)}
                onChange={(e) =>
                  setDraft({ ...draft, careerPositionId: e.target.value })
                }
              >
                <option value="">Chưa chọn vị trí nghề nghiệp</option>
                {draft.careerPositionId &&
                  !careers.some((c) => c.id === draft.careerPositionId) && (
                    <option value={draft.careerPositionId}>
                      {profile.careerPosition?.nameVi ?? "Vị trí đã chọn"}
                      {profile.careerPosition?.nameEn
                        ? ` — ${profile.careerPosition.nameEn}`
                        : ""}
                      {profile.careerPosition?.deletedAt
                        ? " (đã ngừng sử dụng)"
                        : ""}
                    </option>
                  )}
                {Object.entries(careerCategories).map(([category, label]) => (
                  <optgroup key={category} label={label}>
                    {careers
                      .filter((c) => c.category === category)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nameVi} — {c.nameEn}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {careerLoading && (
              <p className="sr-wide" role="status">
                Đang tải vị trí nghề nghiệp…
              </p>
            )}
            {careerError && (
              <div className="sr-wide" role="alert">
                <p>{careerError}</p>
                <button
                  type="button"
                  className="sr-secondary"
                  onClick={() => setRetry((n) => n + 1)}
                >
                  Tải lại danh sách
                </button>
              </div>
            )}
            <label className="sr-wide">
              Sở thích
              <textarea
                rows={3}
                maxLength={2000}
                value={draft.interests}
                onChange={(e) =>
                  setDraft({ ...draft, interests: e.target.value })
                }
                placeholder="Lĩnh vực công nghệ, hoạt động bạn quan tâm…"
              />
            </label>
          </fieldset>
          <div className="sr-actions">
            <button className="sw-primary sr-save" disabled={busy}>
              {busy ? "Đang lưu…" : "Lưu thay đổi"}
            </button>
            <button
              className="sr-secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setError("");
              }}
            >
              Hủy
            </button>
          </div>
        </form>
      ) : (
        <dl className="sr-personal">
          <div>
            <dt>Vị trí nghề nghiệp mong muốn</dt>
            <dd>
              {profile.careerPosition ? (
                <>
                  {profile.careerPosition.nameVi} —{" "}
                  {profile.careerPosition.nameEn}
                  {profile.careerPosition.deletedAt && (
                    <small>
                      {" "}
                      (đã ngừng sử dụng; bạn có thể chọn vị trí khác)
                    </small>
                  )}
                </>
              ) : (
                "Chưa chọn vị trí nghề nghiệp."
              )}
            </dd>
          </div>
          <div>
            <dt>Sở thích</dt>
            <dd>{profile.interests || "Chưa cập nhật sở thích."}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
