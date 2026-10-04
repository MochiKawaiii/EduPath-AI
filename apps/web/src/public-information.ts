export const publicInformationLinks = [
  { href: "/chinh-sach-va-dieu-khoan", label: "Chính sách & Điều khoản" },
  { href: "/cau-hoi-thuong-gap", label: "Câu hỏi thường gặp" }
] as const;

export type FrequentlyAskedQuestion = {
  question: string;
  answer: string[];
  steps?: string[];
  note?: string;
};

export const frequentlyAskedQuestions: FrequentlyAskedQuestion[] = [
  {
    question: "EduPath AI dành cho ai?",
    answer: [
      "EduPath AI dành cho sinh viên Công nghệ Thông tin tại Trường Đại học Văn Lang muốn theo dõi việc học và chuẩn bị cho nghề nghiệp sau này. Bạn có thể xem mình đã học những môn nào, môn nào còn thiếu và các môn dự kiến trong những học kỳ tiếp theo.",
      "Nếu mới bắt đầu, bạn nên kiểm tra thông tin khóa học, lớp học trong hồ sơ rồi tải bảng điểm lên. Từ đó, khi xem chương trình đào tạo hoặc kế hoạch đào tạo, bạn sẽ thấy kết quả của các môn đã có trong bảng điểm. Bạn cũng có thể tìm hiểu các vị trí nghề nghiệp và chọn một mục tiêu phù hợp với sở thích của mình."
    ]
  },
  {
    question: "Tôi cần tài khoản nào để đăng nhập?",
    answer: ["Bạn dùng tài khoản Microsoft do Trường Đại học Văn Lang cấp. Với sinh viên, đây thường là email có đuôi @vanlanguni.vn mà bạn đang sử dụng cho các dịch vụ của trường."],
    steps: [
      "Bấm Đăng nhập trên EduPath AI.",
      "Ở trang Microsoft, chọn tài khoản của trường hoặc nhập email trường cùng mật khẩu của bạn.",
      "Hoàn thành bước xác nhận của Microsoft nếu được yêu cầu. Sau đó bạn sẽ được đưa về EduPath AI."
    ],
    note: "Nếu trình duyệt đang dùng một tài khoản Microsoft cá nhân, hãy chọn Sử dụng tài khoản khác để nhập email trường. Bạn không cần đăng ký tài khoản hay tạo thêm mật khẩu cho EduPath AI. Nếu quên mật khẩu trường, hãy dùng hướng dẫn khôi phục của Microsoft hoặc liên hệ bộ phận hỗ trợ tài khoản của trường."
  },
  {
    question: "Tôi có thể sử dụng những chức năng học tập nào?",
    answer: [
      "Bạn có thể xem và cập nhật hồ sơ, tải bảng điểm PDF, tra cứu chương trình đào tạo, xem kế hoạch đào tạo theo năm học và học kỳ, đồng thời đối chiếu những nhóm môn cần hoàn thành để xét tốt nghiệp.",
      "Sau khi có bảng điểm, cột Kết quả trong chương trình và kế hoạch đào tạo giúp bạn nhận ra môn đã đạt hoặc chưa đạt. Trong phần điều kiện xét tốt nghiệp, bạn có thể xem tiến độ của từng nhóm và số tín chỉ đã đạt. Với nghề nghiệp, bạn có thể xem lĩnh vực, vị trí, yêu cầu kỹ năng và chọn mục tiêu trong Thông tin cá nhân."
    ],
    note: "Bạn nên bắt đầu ở Hồ sơ và bảng điểm, sau đó lần lượt xem Chương trình đào tạo, Kế hoạch đào tạo và Điều kiện xét tốt nghiệp. Những mục đang được phát triển sẽ có thông báo ngay trên màn hình."
  },
  {
    question: "Lộ trình AI có thay thế tư vấn của giảng viên không?",
    answer: [
      "Các gợi ý học tập giúp bạn chuẩn bị phương án và có thêm thông tin để trao đổi với giảng viên hoặc cố vấn học tập. Quyết định đăng ký môn, đổi kế hoạch hay định hướng chuyên ngành vẫn nên dựa trên chương trình đào tạo và thông báo của trường.",
      "Ví dụ, trước khi dự định học một môn vào học kỳ tới, hãy kiểm tra môn tiên quyết, môn phải học trước và việc môn đó có được mở trong đợt đăng ký hay không. Nếu đang phân vân giữa nhiều hướng nghề nghiệp, bạn có thể xem yêu cầu của từng vị trí để chuẩn bị câu hỏi cụ thể cho giảng viên."
    ]
  },
  {
    question: "Làm thế nào để import bảng điểm của tôi?",
    answer: ["Hãy tải bảng điểm dưới dạng PDF từ cổng đào tạo của trường. Tệp cần có dung lượng tối đa 5 MB, không quá 20 trang và không được khóa bằng mật khẩu; bản PDF xuất trực tiếp sẽ dễ đọc hơn ảnh chụp hoặc bản scan."],
    steps: [
      "Đăng nhập EduPath AI và mở Hồ sơ và bảng điểm.",
      "Ở phần Bảng điểm của tôi, chọn hoặc kéo thả tệp PDF bảng điểm của bạn vào vùng tải lên.",
      "Tích ô Tôi xác nhận đây là bảng điểm của mình, bấm Import bảng điểm (hoặc Cập nhật bảng điểm nếu đã có bản cũ) và theo dõi thanh tiến trình cho đến khi có thông báo đã lưu.",
      "Đối chiếu mã môn, tên môn, tín chỉ, điểm và kết quả từng học kỳ với PDF gốc."
    ],
    note: "Nếu xuất hiện thông báo không đọc được tệp, hãy xuất lại bảng điểm từ cổng đào tạo rồi thử với bản PDF đó. Khi cập nhật, bảng điểm mới sẽ thay thế toàn bộ PDF và dữ liệu cũ sau khi đọc thành công, vì vậy nên dùng bản đầy đủ tất cả học kỳ."
  },
  {
    question: "Tại sao bảng điểm đã tải lên nhưng vẫn đang chờ xử lý?",
    answer: [
      "Tải xong tệp và đọc xong bảng điểm là hai bước khác nhau. Khi hiện Đang chờ xử lý, PDF đã được nhận nhưng việc đọc bảng điểm chưa bắt đầu. Khi hiện Đang đọc bảng điểm, các trang và dòng môn học đang được xử lý để tạo bảng kết quả.",
      "Bạn có thể theo dõi thanh tiến trình hoặc quay lại Hồ sơ và bảng điểm sau. Không cần tải lại nhiều lần cùng một tệp khi lần import trước vẫn đang chạy. Chỉ khi có thông báo đã lưu và bảng môn học xuất hiện bên dưới thì việc import mới hoàn tất."
    ],
    note: "Nếu chọn nhầm tệp, dùng Hủy xử lý rồi chọn lại bảng điểm đúng. Nếu có thông báo lỗi, đọc hướng dẫn đi kèm và kiểm tra tệp PDF trước khi thử lại."
  },
  {
    question: "Dấu ✓, dấu ✗ và ô trống trong cột Kết quả có ý nghĩa gì?",
    answer: [
      "Dấu ✓ màu xanh cho biết môn đó đã đạt theo bảng điểm bạn tải lên. Dấu ✗ màu đỏ cho biết môn đã có kết quả nhưng chưa đạt. Nếu môn chưa có trong bảng điểm thì ô để trống hoặc có dấu gạch (—); điều này không có nghĩa là bạn đã học và trượt môn đó.",
      "Điểm chữ MT (miễn thi) được tính là đã đạt, kể cả khi không có điểm số hệ 10 hoặc hệ 4. Khi một môn có nhiều lần học trong bảng điểm, chỉ cần có một lần đạt hoặc được miễn thi thì môn đó được đánh dấu đạt."
    ],
    note: "Nếu kết quả khác với bạn dự kiến, hãy kiểm tra mã học phần và bảo đảm bảng điểm đã cập nhật đủ các học kỳ, bao gồm phần điểm bảo lưu."
  },
  {
    question: "Môn có dấu (*) và nhóm tự chọn được xét như thế nào?",
    answer: [
      "Trong Nhóm bắt buộc, bạn cần đạt toàn bộ các môn được liệt kê. Những môn có dấu (*) vẫn phải đạt nếu nằm trong nhóm bắt buộc, nhưng không cộng vào tín chỉ tích lũy và điểm trung bình. Ví dụ, các môn GDQP có dấu (*) vẫn là những môn cần hoàn thành.",
      "Nhóm tự chọn được xét theo số tín chỉ yêu cầu của từng nhóm. Ví dụ, nếu TC002 yêu cầu 2 tín chỉ và mỗi lựa chọn là một môn 2 tín chỉ, bạn chỉ cần đạt một môn trong nhóm. Không cần học tất cả các môn trong danh sách. Môn có dấu (*) ở nhóm tự chọn vẫn giúp hoàn thành yêu cầu của nhóm, nhưng không cộng vào tín chỉ tích lũy chung."
    ],
    note: "Hãy đọc dòng Đã đạt và Yêu cầu ở đầu mỗi nhóm để biết mình còn thiếu bao nhiêu tín chỉ. Các nhóm khác có thể yêu cầu số tín chỉ khác nhau, tùy tiêu chuẩn bạn đang xem."
  },
  {
    question: "Thông báo đủ điều kiện xét tốt nghiệp có phải là kết quả chính thức không?",
    answer: [
      "Thông báo giúp bạn tự đối chiếu tiến độ học tập với các nhóm môn trong tiêu chuẩn đang xem. Nhóm bắt buộc cần đạt đủ các môn; mỗi nhóm tự chọn cần đủ số tín chỉ yêu cầu. Khi một nhóm chưa hoàn thành, bạn có thể xem danh sách môn và phần tiến độ để biết còn thiếu gì.",
      "Trước khi xem kết quả, hãy chọn đúng tiêu chuẩn của khóa, ngành và chuyên ngành của mình, đồng thời tải lên bảng điểm đầy đủ. Nếu bảng điểm thiếu học kỳ hoặc chưa có kết quả mới nhất, thông báo có thể chưa phản ánh đúng việc học của bạn."
    ],
    note: "Kết quả xét tốt nghiệp chính thức do nhà trường công bố. Bạn nên đối chiếu thêm các thông báo của trường và liên hệ cố vấn học tập nếu cần xác nhận trường hợp cụ thể."
  },
  {
    question: "Tôi chọn mục tiêu nghề nghiệp ở đâu?",
    answer: ["Bạn chọn mục tiêu trong phần Thông tin cá nhân ở Hồ sơ và bảng điểm. Trước khi chọn, có thể xem lĩnh vực nghề nghiệp, danh sách vị trí và các yêu cầu kỹ năng hoặc công nghệ của từng nghề."],
    steps: [
      "Mở Hồ sơ và bảng điểm, tìm dòng Vị trí nghề nghiệp mong muốn trong phần Thông tin cá nhân và bấm Chọn nghề nghiệp.",
      "Chọn một lĩnh vực hoặc nhập tên vị trí, mã hay kỹ năng vào ô Tìm vị trí.",
      "Mở một vị trí để đọc mô tả và các yêu cầu của nghề đó.",
      "Bấm Chọn làm mục tiêu nghề nghiệp. Mục tiêu được lưu ngay và hiển thị lại trong hồ sơ."
    ],
    note: "Bạn có thể chọn một mục tiêu khác khi định hướng thay đổi. Dùng nút Xem yêu cầu cạnh mục tiêu để đọc lại yêu cầu của nghề đang chọn. Nếu muốn bỏ chọn, bấm Chỉnh sửa thông tin, bấm nút Bỏ chọn cạnh mục tiêu rồi bấm Lưu thay đổi."
  },
  {
    question: "Vì sao hồ sơ đã có sẵn họ tên, mã sinh viên, khóa và lớp?",
    answer: [
      "Khi bạn đăng nhập lần đầu, EduPath AI đọc tên hiển thị của tài khoản Microsoft trường. Với tài khoản sinh viên có dạng mã sinh viên – họ tên – lớp, hệ thống tự điền họ tên, mã sinh viên, khóa, lớp và năm nhập học vào hồ sơ để bạn không phải nhập lại.",
      "Những thông tin này gắn với tài khoản trường nên chỉ hiển thị để bạn kiểm tra, không chỉnh sửa trực tiếp trên EduPath AI. Điều này giúp tránh việc nhập nhầm mã sinh viên hoặc dùng mã của người khác."
    ],
    note: "Nếu họ tên, mã sinh viên, khóa hoặc lớp bị sai hay để trống, hãy liên hệ cán bộ phụ trách của Khoa Công nghệ Thông tin để được kiểm tra."
  },
  {
    question: "Tôi có thể chỉnh sửa hoặc xóa dữ liệu đã nhập không?",
    answer: [
      "Bạn có thể mở Thông tin cá nhân, chọn Chỉnh sửa thông tin để cập nhật Sở thích và Vị trí nghề nghiệp mong muốn, rồi bấm Lưu thay đổi. Lớp học và các thông tin định danh lấy từ tài khoản trường chỉ để xem.",
      "Để xóa bảng điểm, mở Hồ sơ và bảng điểm, bấm Xóa bảng điểm và xác nhận. Việc này xóa PDF cùng toàn bộ dữ liệu môn học đã import và hủy lần import đang chờ nếu có; thông tin cá nhân vẫn được giữ lại. Sau đó bạn có thể tải một bảng điểm mới lên."
    ],
    note: "Sau khi xóa bảng điểm, cột Kết quả và phần xét tốt nghiệp sẽ không còn dấu đạt hoặc chưa đạt cho đến khi bạn import lại. Nếu cần xóa toàn bộ tài khoản EduPath AI, hãy liên hệ cán bộ phụ trách của khoa."
  },
  {
    question: "Ai có thể xem bảng điểm và thông tin cá nhân của tôi?",
    answer: [
      "Tệp PDF, điểm và kết quả từng môn trong bảng điểm chỉ hiển thị trong cổng sinh viên khi bạn đăng nhập bằng chính tài khoản của mình. Sinh viên khác không thể xem hồ sơ hay bảng điểm của bạn.",
      "Cán bộ, giảng viên được nhà trường cấp quyền trên cổng quản lý có thể xem thông tin hồ sơ như họ tên, email trường, mã sinh viên, khóa, lớp, sở thích, mục tiêu nghề nghiệp, thời điểm đăng nhập và tình trạng đã có bảng điểm hay chưa. Thông tin này chỉ dùng để hỗ trợ sinh viên và quản lý đào tạo."
    ],
    note: "EduPath AI không bán, không dùng cho quảng cáo và không cung cấp dữ liệu học tập của bạn cho bên ngoài nhà trường vì mục đích thương mại. Chi tiết xem tại trang Chính sách & Điều khoản."
  },
  {
    question: "Bảng điểm PDF của tôi được lưu và xử lý như thế nào?",
    answer: [
      "Sau khi tải lên, PDF được giữ trong hàng chờ để bộ đọc bảng điểm của EduPath AI xử lý. Bộ đọc ưu tiên lớp chữ có sẵn trong PDF và chỉ nhận dạng ký tự (OCR) với những trang không có lớp chữ. Tệp không được gửi tới dịch vụ AI hoặc dịch vụ nhận dạng của bên thứ ba.",
      "Khi đọc xong, hệ thống lưu một bảng điểm hiện tại cho mỗi sinh viên, gồm PDF gốc và dữ liệu môn học đã đọc; bản sao tạm trong hàng chờ được xóa ngay khi xử lý xong, gặp lỗi hoặc bị hủy. Bảng điểm được giữ đến khi bạn cập nhật bằng bản mới hoặc bấm Xóa bảng điểm."
    ]
  },
  {
    question: "Vì sao tôi bị đăng xuất hoặc không vào được cổng sinh viên?",
    answer: [
      "Phiên đăng nhập tự hết hạn sau khoảng 8 giờ không sử dụng để bảo vệ tài khoản trên máy dùng chung. Phiên cũng kết thúc khi tài khoản bị tạm khóa hoặc vai trò được thay đổi; khi đó bạn chỉ cần đăng nhập lại.",
      "Mỗi tài khoản chỉ dùng một cổng theo vai trò được cấp. Nếu thấy thông báo tài khoản thuộc cổng Quản trị, tài khoản của bạn đang được cấp vai trò cán bộ nên không vào được cổng sinh viên."
    ],
    note: "Nếu đã đăng nhập lại mà vẫn không vào được hoặc vai trò hiển thị không đúng, hãy liên hệ cán bộ phụ trách của Khoa Công nghệ Thông tin."
  }
];

type InformationSection = { title: string; paragraphs: string[] };
type InformationCategory = { id: string; label: string; sections: InformationSection[] };
export type PolicyKind = "privacy" | "terms";

export const informationPolicies: Record<PolicyKind, { title: string; categories: InformationCategory[] }> = {
  privacy: {
    title: "Chính sách bảo mật",
    categories: [
      {
        id: "du-lieu",
        label: "Thu thập và sử dụng dữ liệu",
        sections: [
          {
            title: "Thông tin tài khoản và hồ sơ",
            paragraphs: [
              "Khi bạn đăng nhập, EduPath AI nhận từ tài khoản Microsoft của trường tên hiển thị, email trường, tên đăng nhập và mã định danh tài khoản. Với tài khoản sinh viên, hệ thống tự điền họ tên, mã sinh viên, khóa, lớp và năm nhập học từ tên hiển thị.",
              "Hồ sơ còn lưu những thông tin bạn chủ động cung cấp như sở thích và vị trí nghề nghiệp mong muốn. Hãy chỉ nhập nội dung phục vụ việc học; không ghi số điện thoại, số căn cước, địa chỉ hoặc thông tin sức khỏe vào ô Sở thích."
            ]
          },
          {
            title: "Bảng điểm và kết quả học tập",
            paragraphs: ["Khi bạn import bảng điểm, hệ thống lưu tệp PDF gốc, tên và dung lượng tệp cùng dữ liệu đọc được: mã và tên học phần, số tín chỉ, điểm hệ 10, hệ 4, điểm chữ, kết quả đạt hoặc chưa đạt, năm học, học kỳ, điểm bảo lưu và các dòng tổng kết học kỳ."]
          },
          {
            title: "Mục đích sử dụng",
            paragraphs: [
              "Dữ liệu được dùng để hiển thị bảng điểm, đánh dấu kết quả trong chương trình và kế hoạch đào tạo, đối chiếu tiêu chuẩn xét tốt nghiệp, gợi ý định hướng nghề nghiệp và hỗ trợ Khoa Công nghệ Thông tin quản lý đào tạo.",
              "EduPath AI không bán, không dùng cho quảng cáo và không cung cấp dữ liệu học tập của sinh viên cho tổ chức bên ngoài nhà trường vì mục đích thương mại."
            ]
          },
          {
            title: "Nhật ký đăng nhập",
            paragraphs: ["Hệ thống ghi lại thời điểm đăng nhập lần đầu, lần gần nhất và từng lượt đăng nhập (thành công hoặc bị từ chối, cổng đã sử dụng) để bảo vệ tài khoản và hỗ trợ kiểm tra khi có sự cố."]
          }
        ]
      },
      {
        id: "bang-diem",
        label: "Xử lý và lưu trữ bảng điểm",
        sections: [
          {
            title: "Cách bảng điểm được đọc",
            paragraphs: ["PDF bạn tải lên được giữ trong hàng chờ để bộ đọc bảng điểm của EduPath AI xử lý. Bộ đọc ưu tiên lớp chữ có sẵn trong PDF và chỉ nhận dạng ký tự (OCR) với những trang không có lớp chữ. Bảng điểm không được gửi tới dịch vụ AI, chatbot hoặc dịch vụ nhận dạng của bên thứ ba."]
          },
          {
            title: "Thời gian lưu trữ",
            paragraphs: [
              "Bản sao tạm trong hàng chờ được xóa ngay khi xử lý xong, gặp lỗi hoặc khi bạn bấm Hủy xử lý. Mỗi sinh viên chỉ có một bảng điểm hiện tại; khi bạn cập nhật bằng bản mới và việc đọc thành công, PDF và dữ liệu cũ được thay thế hoàn toàn.",
              "Bảng điểm được lưu trên cơ sở dữ liệu của hệ thống cho đến khi bạn xóa, thay thế hoặc khi tài khoản EduPath AI bị xóa. Cơ sở dữ liệu chỉ cho phép máy chủ ứng dụng truy cập, không mở cho truy cập công khai."
            ]
          },
          {
            title: "Xóa bảng điểm",
            paragraphs: ["Khi bạn bấm Xóa bảng điểm và xác nhận, hệ thống xóa PDF cùng toàn bộ dữ liệu môn học đã import và hủy lần import đang chờ nếu có. Thông tin cá nhân trong hồ sơ vẫn được giữ lại để bạn tiếp tục sử dụng."]
          }
        ]
      },
      {
        id: "quyen-truy-cap",
        label: "Quyền truy cập và quyền của bạn",
        sections: [
          {
            title: "Ai có thể xem thông tin của bạn?",
            paragraphs: [
              "Tệp PDF, điểm và kết quả từng môn chỉ hiển thị trong cổng sinh viên khi bạn đăng nhập bằng chính tài khoản của mình. Máy chủ chỉ trả về dữ liệu của tài khoản đang đăng nhập, vì vậy sinh viên khác không thể xem hồ sơ hay bảng điểm của bạn.",
              "Cán bộ, giảng viên được nhà trường cấp quyền trên cổng quản lý có thể xem thông tin hồ sơ gồm họ tên, email trường, mã sinh viên, khóa, lớp, sở thích, mục tiêu nghề nghiệp, thời điểm đăng nhập và tình trạng đã có bảng điểm hay chưa, nhằm hỗ trợ sinh viên và quản lý đào tạo."
            ]
          },
          {
            title: "Quyền của bạn đối với dữ liệu",
            paragraphs: [
              "Bạn có thể xem hồ sơ và bảng điểm của mình bất cứ lúc nào, cập nhật sở thích, chọn hoặc bỏ chọn mục tiêu nghề nghiệp, thay thế hoặc xóa bảng điểm đã import tại phần Hồ sơ và bảng điểm.",
              "Thông tin định danh gắn với tài khoản trường không chỉnh sửa trực tiếp trên EduPath AI. Nếu phát hiện thông tin không chính xác, muốn xóa tài khoản hoặc cần hỗ trợ về dữ liệu cá nhân, hãy liên hệ cán bộ phụ trách của Khoa Công nghệ Thông tin."
            ]
          }
        ]
      },
      {
        id: "bao-ve",
        label: "Bảo vệ tài khoản và phiên đăng nhập",
        sections: [
          {
            title: "Đăng nhập Microsoft",
            paragraphs: ["Việc nhập mật khẩu được thực hiện trên trang xác thực của Microsoft và chỉ tài khoản thuộc Trường Đại học Văn Lang được chấp nhận. EduPath AI không cung cấp ô nhập hoặc lưu mật khẩu Microsoft của bạn. Không chia sẻ tài khoản, mã xác thực hoặc phiên đăng nhập với người khác."]
          },
          {
            title: "Phiên đăng nhập",
            paragraphs: ["Phiên đăng nhập được lưu bằng cookie bảo mật mà mã trên trang web không đọc được, và tự hết hạn sau khoảng 8 giờ không sử dụng. Khi tài khoản bị tạm khóa hoặc vai trò thay đổi, các phiên đang mở sẽ kết thúc và bạn cần đăng nhập lại."]
          },
          {
            title: "Sử dụng thiết bị chung",
            paragraphs: ["Sau khi sử dụng trên máy tính chung, hãy đăng xuất và đóng các cửa sổ đang hiển thị hồ sơ hoặc bảng điểm của bạn. Không lưu tệp bảng điểm trên máy dùng chung sau khi đã import xong."]
          }
        ]
      }
    ]
  },
  terms: {
    title: "Điều khoản sử dụng",
    categories: [
      {
        id: "tai-khoan",
        label: "Tài khoản và phạm vi sử dụng",
        sections: [
          {
            title: "Mục đích của EduPath AI",
            paragraphs: ["EduPath AI hỗ trợ theo dõi học tập và định hướng nghề nghiệp cho sinh viên Công nghệ Thông tin Trường Đại học Văn Lang. Bạn có thể xem các trang giới thiệu, hướng dẫn và chính sách mà không cần đăng nhập; các chức năng hồ sơ và quản lý yêu cầu tài khoản được cấp quyền."]
          },
          {
            title: "Trách nhiệm với tài khoản",
            paragraphs: ["Sử dụng tài khoản Microsoft của chính bạn và bảo vệ thông tin đăng nhập. Mỗi tài khoản chỉ sử dụng cổng tương ứng với vai trò được cấp. Không dùng tài khoản của người khác hoặc tìm cách truy cập dữ liệu, chức năng ngoài quyền được cấp."]
          }
        ]
      },
      {
        id: "noi-dung",
        label: "Bảng điểm và thông tin bạn cung cấp",
        sections: [
          {
            title: "Bảng điểm bạn tải lên",
            paragraphs: [
              "Chỉ tải lên bảng điểm của chính bạn, xuất từ cổng đào tạo của trường và giữ nguyên nội dung. Không chỉnh sửa điểm, ghép trang hoặc tạo tệp giả mạo. Khi tích ô xác nhận trước lúc import, bạn cam kết đây là bảng điểm của mình; hệ thống không xác minh chủ sở hữu từ nội dung PDF.",
              "Bạn chịu trách nhiệm đối chiếu mã môn, điểm và kết quả đã đọc với PDF gốc. Nếu phát hiện sai sót, hãy xuất lại bảng điểm và import lại, hoặc liên hệ cán bộ phụ trách nếu lỗi vẫn còn."
            ]
          },
          {
            title: "Giá trị của bảng điểm trên EduPath AI",
            paragraphs: ["Bảng điểm trên EduPath AI là bản do sinh viên tải lên, chưa được nhà trường xác minh. Bảng điểm này chỉ dùng để tự theo dõi học tập trong hệ thống, không thay thế bảng điểm chính thức và không dùng làm minh chứng với nhà trường hoặc bên thứ ba."]
          },
          {
            title: "Thông tin hồ sơ",
            paragraphs: ["Sở thích và mục tiêu nghề nghiệp cần phản ánh đúng định hướng của bạn. Không nhập dữ liệu cá nhân của người khác, nội dung xúc phạm hoặc thông tin nhạy cảm không cần thiết như số căn cước, số điện thoại, địa chỉ hay thông tin sức khỏe."]
          },
          {
            title: "Dữ liệu đào tạo và nghề nghiệp",
            paragraphs: ["Chương trình đào tạo, kế hoạch đào tạo, tiêu chuẩn xét tốt nghiệp và yêu cầu nghề nghiệp được quản lý trên hệ thống theo từng phiên bản. Khi sử dụng, hãy đối chiếu đúng khóa, ngành và chuyên ngành; ưu tiên thông báo và tài liệu chính thức của nhà trường nếu có khác biệt."]
          }
        ]
      },
      {
        id: "du-lieu-sinh-vien",
        label: "Sử dụng dữ liệu sinh viên",
        sections: [
          {
            title: "Trách nhiệm của cán bộ và giảng viên",
            paragraphs: ["Cán bộ, giảng viên được cấp quyền trên cổng quản lý chỉ xem và sử dụng thông tin sinh viên trong phạm vi công việc được giao như hỗ trợ học tập, tư vấn và quản lý đào tạo. Không sao chép, chụp màn hình, xuất hoặc chia sẻ thông tin sinh viên ra ngoài khi không có căn cứ công việc, và tuân thủ quy định của nhà trường cũng như pháp luật về bảo vệ dữ liệu cá nhân."]
          },
          {
            title: "Hành vi không được phép",
            paragraphs: ["Không truy cập hoặc tìm cách xem hồ sơ, bảng điểm của người khác; không dùng công cụ tự động để thu thập dữ liệu; không tải lên tệp chứa mã độc hoặc can thiệp vào hoạt động của hệ thống."]
          }
        ]
      },
      {
        id: "ket-qua",
        label: "Kết quả phân tích và hỗ trợ",
        sections: [
          {
            title: "Kết quả học tập và xét điều kiện",
            paragraphs: ["Các dấu đạt, chưa đạt và thông báo xét điều kiện được tạo từ bảng điểm bạn tải lên và tiêu chuẩn đang có trên hệ thống. Kết quả có thể thay đổi khi bạn cập nhật bảng điểm hoặc khi tiêu chuẩn được điều chỉnh. Thông báo trên EduPath AI hỗ trợ bạn tự đối chiếu; kết quả xét tốt nghiệp chính thức do nhà trường công bố."]
          },
          {
            title: "Định hướng và trợ giúp",
            paragraphs: ["Mục tiêu nghề nghiệp và các gợi ý học tập là thông tin tham khảo để bạn chủ động chuẩn bị. Trao đổi với giảng viên hoặc cố vấn học tập trước những quyết định quan trọng. Nếu gặp vấn đề khi sử dụng, xem Câu hỏi thường gặp hoặc liên hệ cán bộ phụ trách của Khoa Công nghệ Thông tin."]
          },
          {
            title: "Vi phạm và cập nhật điều khoản",
            paragraphs: ["Tài khoản vi phạm điều khoản có thể bị tạm khóa quyền truy cập và được xử lý theo quy định của nhà trường. Chính sách và điều khoản có thể được cập nhật khi hệ thống bổ sung chức năng; nội dung mới được đăng tại trang này và áp dụng từ lần sử dụng tiếp theo."]
          }
        ]
      }
    ]
  }
};
