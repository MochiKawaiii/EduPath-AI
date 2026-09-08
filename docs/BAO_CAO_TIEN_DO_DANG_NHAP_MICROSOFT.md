# BÁO CÁO TIẾN ĐỘ XÂY DỰNG CHỨC NĂNG ĐĂNG NHẬP MICROSOFT – HỆ THỐNG EDUPATH AI

## 1. Thông tin chung

- **Tên đề tài:** Thiết kế và xây dựng hệ thống đánh giá năng lực và tư vấn lộ trình học tập cho sinh viên Công nghệ Thông tin với AI.
- **Tên hệ thống:** EduPath AI.
- **Chức năng được triển khai:** STU-AUTH-01 – Đăng nhập bằng tài khoản Microsoft.
- **Đối tượng sử dụng chính:** Sinh viên Trường Đại học Văn Lang.
- **Ngày lập báo cáo:** 31/08/2026.
- **Phạm vi báo cáo:** Từ khởi tạo mã nguồn đến tích hợp Microsoft Entra ID, hoàn thiện giao diện, kiểm thử, đưa mã nguồn lên GitHub và chuẩn bị triển khai Render.

## 2. Mục tiêu của giai đoạn

Giai đoạn hiện tại tập trung xây dựng nền tảng kỹ thuật ban đầu cho EduPath AI. Chức năng đầu tiên cho phép sinh viên đăng nhập bằng tài khoản Microsoft của tổ chức và phải đáp ứng các yêu cầu:

1. Người dùng đăng nhập qua Microsoft, không nhập mật khẩu trực tiếp vào EduPath AI.
2. Backend chịu trách nhiệm trao đổi mã xác thực và quản lý phiên đăng nhập.
3. Frontend không lưu access token, ID token hoặc Client Secret.
4. Hỗ trợ tài khoản thuộc tenant thử nghiệm và tenant của Trường Đại học Văn Lang.
5. Giao diện thể hiện nhận diện EduPath AI và Văn Lang, hoạt động tốt trên máy tính và điện thoại.
6. Mã nguồn không làm lộ thông tin bí mật khi đưa lên GitHub.
7. Dự án có thể build và triển khai trên Render.

## 3. Kiến trúc đã xây dựng

    Trình duyệt sinh viên
            │
            │ React + request /api cùng origin
            ▼
    Node.js / Express BFF
            │
            │ Authorization Code Flow + PKCE
            ▼
    Microsoft Entra ID
            │
            │ callback xác thực
            ▼
    Express tạo HttpOnly session cookie
            │
            └────────► React nhận người dùng từ /api/auth/me

Dự án được tổ chức theo mô hình npm workspaces:

    EduPath_AI/
    ├─ apps/
    │  ├─ api/        Backend Node.js, Express và MSAL Node
    │  └─ web/        Frontend React, TypeScript và Vite
    ├─ docs/           Tài liệu dự án
    ├─ scripts/        Công cụ hỗ trợ cấu hình môi trường
    ├─ render.yaml     Cấu hình triển khai Render
    ├─ package.json
    └─ README.md

## 4. Các công việc đã hoàn thành

### 4.1. Khởi tạo dự án

- Tạo thư mục làm việc thống nhất **EduPath_AI**.
- Thiết lập npm workspaces cho frontend và backend.
- Thiết lập các lệnh dùng chung:
  - **npm run dev:** chạy frontend và backend.
  - **npm run typecheck:** kiểm tra TypeScript.
  - **npm test:** chạy kiểm thử tự động.
  - **npm run build:** tạo bản build production.
  - **npm start:** chạy backend production và phục vụ frontend đã build.
- Khóa phiên bản Node.js ở **22.21.0** để môi trường local và Render nhất quán.

### 4.2. Cấu hình Microsoft Entra ID

- Sử dụng App Registration dạng **Multiple Entra ID tenants**.
- Sử dụng platform **Web** cho callback bảo mật phía backend.
- Cấu hình callback local:

      http://localhost:4000/api/auth/microsoft/callback

- Cấu hình callback HTTPS theo hostname thực tế của Render.
- Đọc Application ID, Directory ID và Client Secret từ biến môi trường, không ghi trực tiếp vào source code.
- Cho phép tenant sở hữu App Registration và tenant của **vlu.edu.vn** thông qua allowlist.
- Theo kết quả kiểm thử của người dùng, tài khoản VLU đã được Microsoft tiếp nhận trong luồng đăng nhập.

### 4.3. Xây dựng backend xác thực

Backend đã triển khai:

- Microsoft Authentication Library cho Node.js.
- Authorization Code Flow kết hợp PKCE S256.
- Sinh và kiểm tra **state**, **nonce**, **code verifier** và **code challenge**.
- Giới hạn thời gian tồn tại của giao dịch đăng nhập.
- Kiểm tra các claim quan trọng: tenant ID, object ID, audience, issuer, nonce và thời gian hết hạn.
- Định danh người dùng bằng cặp **tenantId:objectId**, không phụ thuộc riêng vào email.
- Tạo lại session sau khi xác thực nhằm hạn chế session fixation.
- Lưu session bằng cookie HttpOnly, SameSite=Lax và Secure khi chạy production.
- Hỗ trợ hai vai trò **student** và **admin**.
- Vai trò Admin chỉ được cấp khi token có App Role Admin.
- Trong phạm vi demo, người dùng thuộc tenant được phép nhưng chưa có App Role sẽ nhận vai trò Student.

Các API hiện có:

| Phương thức | Endpoint | Chức năng |
|---|---|---|
| GET | /api/health | Kiểm tra trạng thái backend |
| GET | /api/auth/microsoft/start | Khởi tạo đăng nhập Microsoft |
| GET | /api/auth/microsoft/callback | Nhận callback từ Microsoft |
| GET | /api/auth/me | Lấy người dùng đang đăng nhập |
| POST | /api/auth/logout | Hủy session và đăng xuất |
| GET | /api/student/summary | API yêu cầu đăng nhập |
| GET | /api/admin/summary | API yêu cầu quyền Admin |

### 4.4. Các biện pháp bảo mật đã áp dụng

- Không xây dựng ô nhập mật khẩu Microsoft tại EduPath AI.
- Không truyền token Microsoft xuống React.
- Không lưu Client Secret trong frontend.
- Dùng Helmet để thiết lập HTTP security headers.
- Tắt header **x-powered-by**.
- Giới hạn kích thước request body.
- Tạo correlation ID cho request để hỗ trợ truy vết lỗi.
- Kiểm tra origin khi đăng xuất.
- Kiểm tra đường dẫn trả về để hạn chế open redirect.
- Chặn cấu hình production nguy hiểm khi vừa cho phép mọi tenant vừa tự động gán mọi tài khoản thành Student.
- File môi trường, tài khoản demo, build output và cache đều được loại khỏi Git.

### 4.5. Xây dựng frontend đăng nhập

- Xây dựng ứng dụng React, TypeScript và Vite.
- Tạo trang đăng nhập sử dụng ảnh khuôn viên Văn Lang làm nền.
- Sử dụng logo Văn Lang do người dùng cung cấp.
- Xây dựng nhận diện EduPath AI với tông xanh – vàng.
- Hoàn thiện header, logo, điều hướng, card đăng nhập, nút Microsoft, thông báo hỗ trợ tài khoản VLU và hiệu ứng sóng.
- Giữ trạng thái lỗi đăng nhập có thuộc tính trợ năng **role="alert"**.
- Thiết kế responsive cho desktop và điện thoại.
- Thêm trạng thái focus, hover và hỗ trợ **prefers-reduced-motion**.
- Sau đăng nhập, hệ thống có trang dashboard tối thiểu hiển thị tên, tài khoản, vai trò, thời điểm đăng nhập và nút đăng xuất.

### 4.6. Kiểm thử và chất lượng

Các kiểm tra đã thực hiện:

- TypeScript frontend và backend: **đạt**.
- 18/18 kiểm thử tự động backend: **đạt**.
- Production build frontend và backend: **đạt**.
- Kiểm tra trực quan bằng trình duyệt tự động:
  - Giao diện desktop.
  - Giao diện mobile.
  - Trạng thái lỗi đăng nhập.
  - Nút đăng nhập chuyển đúng đến Microsoft.
- Production smoke test:
  - Trang gốc trả HTTP 200 và chứa EduPath AI.
  - Endpoint **/api/health** trả trạng thái **ok**.
  - API không tồn tại trả HTTP 404.

Giới hạn kiểm thử hiện tại: frontend chưa có bộ kiểm thử component hoặc E2E tự động trong repository.

### 4.7. Quản lý mã nguồn GitHub

- Khởi tạo Git repository với branch **main**.
- Repository: [MochiKawaiii/EduPath-AI](https://github.com/MochiKawaiii/EduPath-AI).
- Kiểm tra nội dung staged trước khi commit.
- Không phát hiện Client Secret, Session Secret, mật khẩu demo hoặc file môi trường trong commit.
- Các commit chính:

| Commit | Nội dung |
|---|---|
| 69e1a26 | Khởi tạo EduPath AI và chức năng đăng nhập Microsoft |
| 57b92b8 | Sửa cài đặt build dependencies khi triển khai Render |

## 5. Công việc triển khai Render

### 5.1. Nội dung đã chuẩn bị

- Thêm **render.yaml** cho một Node.js Web Service.
- Frontend và backend được phục vụ chung một domain.
- Express phục vụ thư mục build của React.
- Có SPA fallback cho các đường dẫn React.
- Cấu hình Render:

| Trường | Giá trị |
|---|---|
| Runtime | Node |
| Node version | 22.21.0 |
| Build Command | npm ci --include=dev && npm run build |
| Start Command | npm start |
| Health Check | /api/health |

- Ứng dụng tự sử dụng hostname Render để tạo Web origin, Microsoft callback URL và post-logout URL.

### 5.2. Các lỗi triển khai đã phát hiện và cách xử lý

#### Lỗi 1: Thiếu SESSION_SECRET

- **Hiện tượng:** Build thành công nhưng backend dừng khi khởi động.
- **Nguyên nhân:** Render Web Service được tạo thủ công nên giá trị tự sinh trong Blueprint chưa được áp dụng.
- **Cách xử lý:** Thêm SESSION_SECRET ngẫu nhiên dài tối thiểu 32 ký tự trong Render Environment.

#### Lỗi 2: Không tìm thấy type definitions của React

- **Hiện tượng:** TypeScript báo thiếu React, React DOM, JSX runtime và CSS declarations.
- **Nguyên nhân:** Khi NODE_ENV=production, lệnh npm ci bỏ qua devDependencies; TypeScript, Vite và các gói type cần cho bước build nằm trong nhóm này.
- **Cách xử lý:** Đổi Build Command thành:

      npm ci --include=dev && npm run build

- Bản sửa đã được kiểm thử local trong môi trường NODE_ENV=production và đã push lên GitHub.

### 5.3. Trạng thái Render hiện tại

- Mã nguồn và cấu hình sửa lỗi đã có trên GitHub.
- Các biến môi trường chính đã được nhập trên Render.
- Callback HTTPS của Render đã được thêm trong Microsoft Entra.
- Cần cập nhật Build Command của Web Service thủ công và chạy lại **Save, rebuild, and deploy**.
- Chưa xác nhận lần deploy cuối cùng hoạt động thành công trên URL public tại thời điểm lập báo cáo.

## 6. Các biến môi trường sử dụng

Báo cáo chỉ liệt kê tên biến, không lưu giá trị:

| Biến | Mục đích |
|---|---|
| NODE_ENV | Chế độ chạy ứng dụng |
| TRUST_PROXY | Tin cậy reverse proxy của Render |
| SESSION_SECRET | Ký session cookie |
| SESSION_MAX_AGE_MS | Thời hạn session |
| ENTRA_CLIENT_ID | Định danh App Registration |
| ENTRA_CLIENT_SECRET | Xác thực backend với Microsoft |
| ENTRA_TENANT_ID | Tenant sở hữu App Registration |
| ENTRA_AUTHORITY | Microsoft authority |
| ENTRA_ALLOW_ANY_TENANT | Cho phép hoặc chặn tenant ngoài danh sách |
| ENTRA_ALLOWED_TENANT_IDS | Danh sách tenant được phép |
| AUTH_DEFAULT_ROLE | Vai trò mặc định trong bản demo |

## 7. Bảng trạng thái

| Hạng mục | Trạng thái |
|---|---|
| Cấu trúc dự án React + Express | Hoàn thành |
| Microsoft authentication tại local | Hoàn thành cho bản demo |
| Session, kiểm tra tenant và phân quyền cơ bản | Hoàn thành cho bản demo |
| Giao diện đăng nhập responsive | Hoàn thành |
| Kiểm thử backend, typecheck và build | Hoàn thành |
| Đưa mã nguồn lên GitHub | Hoàn thành |
| Render production deployment | Đang triển khai và nghiệm thu |
| PostgreSQL và persistent session | Chưa thực hiện |
| Hồ sơ và bảng điểm sinh viên | Chưa thực hiện |
| Đánh giá năng lực | Chưa thực hiện |
| AI gợi ý lộ trình | Chưa thực hiện |
| Trang quản trị hoàn chỉnh | Chưa thực hiện |

## 8. Hạn chế và rủi ro hiện tại

1. Session đang dùng MemoryStore của Express Session, chỉ phù hợp demo một instance.
2. Khi Render restart, người dùng có thể phải đăng nhập lại.
3. Mọi tài khoản thuộc tenant được phép hiện có thể nhận vai trò Student mặc định; chưa đối soát danh sách sinh viên chính thức.
4. Chưa tích hợp PostgreSQL hoặc Redis làm session store.
5. Chưa có dữ liệu hồ sơ, bảng điểm, đánh giá năng lực và lộ trình học tập.
6. Chưa có trang quản trị hoàn chỉnh.
7. Chưa có tên miền chính thức do Nhà trường cấp.
8. Client Secret đã xuất hiện trong ảnh chụp màn hình, vì vậy phải thu hồi và tạo secret mới trước khi demo công khai.
9. Mật khẩu tài khoản demo từng được chia sẻ cần được đổi.

## 9. Công việc cần thực hiện tiếp theo

### Ưu tiên ngay

1. Thu hồi Client Secret đã lộ, tạo secret mới và cập nhật Render.
2. Thay Build Command trên Render và deploy lại.
3. Kiểm tra endpoint /api/health trên URL public.
4. Kiểm tra đăng nhập bằng tài khoản tenant thử nghiệm và tài khoản Microsoft VLU.
5. Kiểm tra callback, session và đăng xuất trên HTTPS.
6. Đưa URL gốc của Render vào Front-channel logout URL thay vì dùng như callback chính.

### Giai đoạn tiếp theo

1. Thay MemoryStore bằng PostgreSQL hoặc Redis.
2. Thiết kế bảng người dùng và liên kết tenant ID với object ID.
3. Xây dựng cơ chế xác minh sinh viên từ danh sách chính thức hoặc Microsoft Graph.
4. Hoàn thiện phân quyền Student và Admin.
5. Xây dựng hồ sơ sinh viên và nhập bảng điểm.
6. Xây dựng mô-đun đánh giá năng lực.
7. Xây dựng mô-đun gợi ý lộ trình học tập và nghề nghiệp.
8. Xây dựng trang quản trị Khoa/Giảng viên.

## 10. Kết luận

Chức năng đăng nhập Microsoft của EduPath AI đã hoàn thành ở mức mã nguồn, giao diện, bảo mật cơ bản và kiểm thử local. Dự án đã được đưa lên GitHub an toàn và có cấu hình production cho Render. Công việc còn lại của giai đoạn này là áp dụng Build Command mới trên Render, xoay vòng Client Secret đã bị lộ trong ảnh và xác nhận đầy đủ luồng đăng nhập VLU trên URL public.
