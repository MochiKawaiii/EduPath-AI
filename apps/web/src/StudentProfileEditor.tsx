import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "./student-icons";
import { type CareerSelection } from "./career-types";
import StudentCareerExplorer from "./StudentCareerExplorer";
import "./student-records.css";
export type EditableStudentProfile = {
  className: string | null;
  interests: string | null;
  careerGoal: string | null;
  careerPositionId?: string | null;
  careerPosition?: CareerSelection | null;
};
async function updateProfile(input: { interests?: string; careerPositionId: string | null }) {
  const res = await fetch("/api/student/profile", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
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
}
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
  const [draftCareer, setDraftCareer] = useState<CareerSelection | null>(profile.careerPosition ?? null);
  const [explorer, setExplorer] = useState<{ initialCareerId?: string } | null>(null);
  useEffect(() => {
    if (!editing) {
      setDraft({
        interests: profile.interests ?? "",
        careerPositionId: profile.careerPositionId ?? "",
      });
      setDraftCareer(profile.careerPosition ?? null);
    }
  }, [profile, editing]);
  const chooseCareer = async (career: Pick<CareerSelection, "id" | "nameVi" | "nameEn">) => {
    setBusy(true);
    try {
      await updateProfile({ careerPositionId: career.id });
      setDraft(value => ({ ...value, careerPositionId: career.id }));
      setDraftCareer({ id: career.id, nameVi: career.nameVi, nameEn: career.nameEn, deletedAt: null });
      setExplorer(null);
      setError("");
      setMessage(`Đã lưu mục tiêu nghề nghiệp: ${career.nameVi}.`);
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await updateProfile({
        ...draft,
        careerPositionId: draft.careerPositionId || null,
      });
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
            <div className="sr-wide sr-career-target">
              <strong>Vị trí nghề nghiệp mong muốn</strong>
              <div className="sr-career-selection">
                <span>{draftCareer ? `${draftCareer.nameVi} — ${draftCareer.nameEn}${draftCareer.deletedAt ? " (đã ngừng sử dụng)" : ""}` : "Chưa chọn vị trí nghề nghiệp."}</span>
                {draft.careerPositionId && <>
                  {!draftCareer?.deletedAt && <button type="button" className="sr-career-icon" aria-label="Xem yêu cầu nghề nghiệp" title="Xem yêu cầu" onClick={() => setExplorer({ initialCareerId: draft.careerPositionId })}><Icon name="eye" /></button>}
                  <button type="button" className="sr-career-icon sr-career-clear" aria-label="Bỏ chọn nghề nghiệp" title="Bỏ chọn" onClick={() => { setDraft({ ...draft, careerPositionId: "" }); setDraftCareer(null); }}><Icon name="close" /></button>
                </>}
              </div>
              <div className="sr-actions">
                <button type="button" className="sr-secondary sr-career-choose" onClick={() => setExplorer({})}>Chọn nghề nghiệp</button>
              </div>
            </div>
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
          <div className="sr-actions sr-form-actions">
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
            <button className="sw-primary" disabled={busy}>
              {busy ? "Đang lưu…" : "Lưu thay đổi"}
            </button>
          </div>
        </form>
      ) : (
        <dl className="sr-personal">
          <div>
            <dt>Vị trí nghề nghiệp mong muốn</dt>
            <dd className="sr-career-selection">
              <span>{profile.careerPosition ? (
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
              )}</span>
              {profile.careerPositionId && !profile.careerPosition?.deletedAt && <button type="button" className="sr-career-icon" aria-label="Xem yêu cầu nghề nghiệp" title="Xem yêu cầu" onClick={() => setExplorer({ initialCareerId: profile.careerPositionId! })}><Icon name="eye" /></button>}
            </dd>
            <div className="sr-actions">
              <button type="button" className="sr-secondary sr-career-choose" onClick={() => setExplorer({})}>Chọn nghề nghiệp</button>
            </div>
          </div>
          <div>
            <dt>Sở thích</dt>
            <dd>{profile.interests || "Chưa cập nhật sở thích."}</dd>
          </div>
        </dl>
      )}
      {explorer && <StudentCareerExplorer selectedId={profile.careerPositionId ?? ""} initialCareerId={explorer.initialCareerId} onSelect={chooseCareer} onClose={() => setExplorer(null)} />}
    </section>
  );
}
