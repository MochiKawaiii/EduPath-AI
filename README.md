# EduPath AI

Nền tảng đánh giá năng lực và tư vấn lộ trình học tập cho sinh viên Công nghệ
Thông tin. Phiên bản hiện tại triển khai chức năng `STU-AUTH-01` — đăng nhập bằng
tài khoản Microsoft Entra ID.

## Kiến trúc đăng nhập

```text
React → Node.js BFF → Microsoft Entra ID
  ↑          ↓
  └── HttpOnly session cookie
```

- React không nhận access token, ID token hoặc Client Secret.
- Node.js dùng Authorization Code Flow với PKCE S256, `state` và `nonce`.
- Session ID được đổi sau khi đăng nhập để chống session fixation.
- Người dùng được định danh bằng cặp `(tid, oid)`, không phải email.
- Role `Admin` chỉ đến từ App Role của Entra. Trong demo, tài khoản không có role
  được mặc định là `Student`; cấu hình này bị chặn khi chạy production mở cho mọi
  tenant.

## Cấu trúc

```text
EduPath_AI/
├─ apps/
│  ├─ api/   Node.js, Express, MSAL Node
│  └─ web/   React, Vite
├─ package.json
└─ README.md
```

## Cấu hình Microsoft Entra

App Registration phát triển cần có:

- Supported account types: `Multiple Entra ID tenants`.
- Platform: `Web`.
- Redirect URI: `http://localhost:4000/api/auth/microsoft/callback`.
- App Roles tùy chọn: `Admin` và `Student`.
- `Assignment required = No` nếu muốn mọi tài khoản tổ chức có thể thử đăng nhập.

Không đặt mật khẩu tài khoản demo hoặc Client Secret vào Git.

## Chạy local

Yêu cầu Node.js 22 trở lên.

1. Cài dependency:

   ```powershell
   npm install
   ```

2. Sao chép file cấu hình mẫu:

   ```powershell
   Copy-Item .\apps\api\.env.example .\apps\api\.env
   ```

   Nếu thông tin Entra đang nằm trong file `../tk_demo`, có thể nhập tự động mà
   không sao chép các mật khẩu tài khoản demo:

   ```powershell
   npm run setup:demo-env
   ```

3. Mở `apps/api/.env` và điền ba giá trị đã lưu từ Entra:

   - `ENTRA_CLIENT_ID`
   - `ENTRA_TENANT_ID`
   - `ENTRA_CLIENT_SECRET` — dùng trường **Value**, không phải Secret ID

   Đồng thời thay `SESSION_SECRET` bằng chuỗi ngẫu nhiên dài tối thiểu 32 ký tự.

4. Chạy cả API và Web:

   ```powershell
   npm run dev
   ```

5. Mở `http://localhost:5173` và chọn **Đăng nhập bằng Microsoft**.

## Triển khai lên Render

Dự án dùng một Render Web Service để Express phục vụ cả API và bản React đã
build. Frontend và backend cùng origin nên không cần cấu hình CORS và cookie đăng
nhập vẫn là HttpOnly, SameSite=Lax.

### Cách khuyến nghị: Render Blueprint

1. Trong Render Dashboard, chọn **New > Blueprint**.
2. Kết nối repository GitHub `MochiKawaiii/EduPath-AI`.
3. Chọn branch `main`; Render sẽ đọc file `render.yaml` ở thư mục gốc.
4. Khi Render yêu cầu các biến có `sync: false`, nhập:

   | Biến | Giá trị cần nhập |
   |---|---|
   | `ENTRA_CLIENT_ID` | **Application (client) ID** trong App Registration |
   | `ENTRA_CLIENT_SECRET` | Cột **Value** của Client Secret, không phải Secret ID |
   | `ENTRA_TENANT_ID` | **Directory (tenant) ID** của tenant đang sở hữu App Registration |

   `SESSION_SECRET` được Render tự tạo. Tenant chính thức của
   `vlu.edu.vn` đã được khai báo trong allowlist bằng tenant ID công khai
   `3011a54b-0a5d-4929-bf02-a00787877c6a`.

5. Sau lần deploy đầu tiên, sao chép URL dạng
   `https://<ten-service>.onrender.com`.
6. Trong Microsoft Entra > **App registrations > Authentication > Web**, thêm:

   - Redirect URI:
     `https://<ten-service>.onrender.com/api/auth/microsoft/callback`
   - Front-channel logout URL (nếu dùng):
     `https://<ten-service>.onrender.com/`

Ứng dụng tự đọc hostname do Render cấp để tạo `WEB_ORIGIN`,
`ENTRA_REDIRECT_URI` và `ENTRA_POST_LOGOUT_REDIRECT_URI`. Không cần nhập lại
ba biến này trên Render trừ khi dùng custom domain hoặc tách frontend/backend.

### Nếu tạo Web Service thủ công

| Trường Render | Giá trị |
|---|---|
| Language | `Node` |
| Branch | `main` |
| Root Directory | để trống |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

Sau đó thêm các biến môi trường giống `render.yaml`. Tuyệt đối không upload file
`.env` hoặc file tài khoản demo lên GitHub/Render.

> Bản hiện tại dùng MemoryStore của `express-session`, phù hợp cho demo một
> instance. Khi service restart, người dùng cần đăng nhập lại. Trước khi vận hành
> thật, chuyển session sang PostgreSQL hoặc Redis.

## Lệnh kiểm tra

```powershell
npm run typecheck
npm test
npm run build
```

## API hiện có

| Method | Endpoint | Chức năng |
|---|---|---|
| `GET` | `/api/health` | Kiểm tra API |
| `GET` | `/api/auth/microsoft/start` | Bắt đầu đăng nhập Microsoft |
| `GET` | `/api/auth/microsoft/callback` | Nhận authorization code |
| `GET` | `/api/auth/me` | Lấy phiên người dùng hiện tại |
| `POST` | `/api/auth/logout` | Hủy phiên và đăng xuất Microsoft |
| `GET` | `/api/student/summary` | Endpoint yêu cầu đăng nhập |
| `GET` | `/api/admin/summary` | Endpoint chỉ dành cho role Admin |

## Trước khi triển khai thật

- Đổi `ENTRA_ALLOW_ANY_TENANT=false` và allowlist tenant VLU.
- Đổi `AUTH_DEFAULT_ROLE=none`, yêu cầu App Role hoặc đối soát danh sách sinh viên.
- Thay `express-session` MemoryStore bằng PostgreSQL/Redis.
- Dùng HTTPS, credential trong secret manager và cấu hình `TRUST_PROXY=true` khi
  chạy sau reverse proxy.
- Không chuyển dữ liệu tài khoản thử nghiệm sang production bằng cách ghép email.
