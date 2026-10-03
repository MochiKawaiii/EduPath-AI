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
      "Sau khi có bảng điểm, cột Kết quả trong chương trình và kế hoạch đào tạo giúp bạn nhận ra môn đã đạt hoặc chưa đạt. Trong phần điều kiện xét tốt nghiệp, bạn có thể xem tiến độ của từng nhóm và số tín chỉ đã hoàn thành. Với nghề nghiệp, bạn có thể xem lĩnh vực, vị trí, yêu cầu kỹ năng và chọn mục tiêu trong Thông tin cá nhân."
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
    answer: ["Hãy tải bảng điểm dưới dạng PDF từ cổng đào tạo của trường. Tệp cần có dung lượng tối đa 5 MB và không được khóa bằng mật khẩu; bản PDF xuất trực tiếp sẽ dễ đọc hơn ảnh chụp hoặc bản scan."],
    steps: [
      "Đăng nhập EduPath AI và mở Hồ sơ và bảng điểm.",
      "Ở phần Bảng điểm của tôi, chọn hoặc kéo thả tệp PDF bảng điểm của bạn vào vùng tải lên.",
      "Tích xác nhận đây là bảng điểm của mình, bấm Import bảng điểm (hoặc Cập nhật bảng điểm nếu đã có bản cũ) và theo dõi thanh tiến trình cho đến khi có thông báo đã lưu.",
      "Đối chiếu mã môn, tên môn, tín chỉ, điểm và kết quả từng học kỳ với PDF gốc."
    ],
    note: "Nếu xuất hiện thông báo không đọc được tệp, hãy xuất lại bảng điểm từ cổng đào tạo rồi thử với bản PDF đó. Khi cập nhật bảng điểm mới, nên dùng bản đầy đủ để các môn đã học được đối chiếu chính xác."
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
    question: "Dấu ✓, dấu ✕ và ô trống trong cột Kết quả có ý nghĩa gì?",
    answer: [
      "Dấu ✓ màu xanh cho biết môn đó đã đạt theo bảng điểm bạn tải lên. Dấu ✕ màu đỏ cho biết môn đã có kết quả nhưng chưa đạt. Nếu môn chưa có trong bảng điểm thì ô để trống hoặc có dấu gạch; điều này không có nghĩa là bạn đã học và trượt môn đó.",
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
    note: "Hãy đọc mức Yêu cầu ở đầu mỗi nhóm và phần Đã hoàn thành để biết mình còn thiếu bao nhiêu. Các nhóm khác có thể yêu cầu số tín chỉ khác nhau, tùy tiêu chuẩn bạn đang xem."
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
      "Mở Hồ sơ và bảng điểm, tìm phần Thông tin cá nhân và bấm Chỉnh sửa thông tin.",
      "Bấm Khám phá và chọn nghề nghiệp, sau đó tìm hoặc lọc lĩnh vực bạn quan tâm.",
      "Xem chi tiết một vị trí để đọc mô tả và các yêu cầu của nghề đó.",
      "Bấm Chọn làm mục tiêu nghề nghiệp. Mục tiêu được lưu ngay và hiển thị lại trong hồ sơ."
    ],
    note: "Bạn có thể chọn một mục tiêu khác khi định hướng thay đổi. Nếu vừa sửa thêm sở thích hoặc thông tin khác trong biểu mẫu, hãy bấm Lưu thay đổi để lưu những phần đó."
  },
  {
    question: "Tôi có thể chỉnh sửa hoặc xóa dữ liệu đã nhập không?",
    answer: [
      "Bạn có thể mở Thông tin cá nhân, chọn Chỉnh sửa thông tin để cập nhật các ô đang cho phép nhập, rồi bấm Lưu thay đổi. Mục tiêu nghề nghiệp cũng có thể chọn lại khi bạn muốn tìm hiểu một hướng khác.",
      "Để xóa bảng điểm, mở Hồ sơ và bảng điểm, bấm Xóa bảng điểm và xác nhận. Việc này xóa PDF cùng dữ liệu môn học đã import; thông tin cá nhân vẫn được giữ lại. Sau đó bạn có thể tải một bảng điểm mới lên."
    ],
    note: "Nếu phát hiện tên, email trường, mã sinh viên hoặc thông tin đào tạo sai mà không có ô chỉnh sửa, hãy liên hệ cán bộ phụ trách của khoa để được kiểm tra."
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
            title: "Thông tin được sử dụng",
            paragraphs: ["EduPath AI sử dụng thông tin định danh từ tài khoản Microsoft khi bạn đăng nhập, cùng các thông tin trong hồ sơ như tên, email, mã sinh viên, khóa học và lớp học. Hệ thống cũng lưu những thông tin bạn chủ động cung cấp, chẳng hạn sở thích, mục tiêu nghề nghiệp và bảng điểm."]
          },
          {
            title: "Phân tích và lưu trữ",
            paragraphs: ["Bảng điểm PDF được đọc để tạo dữ liệu học phần, tín chỉ và kết quả học tập. Các dữ liệu này phục vụ việc hiển thị bảng điểm, đối chiếu chương trình đào tạo, kế hoạch đào tạo và tiêu chuẩn xét tốt nghiệp.", "Hồ sơ và kết quả học tập được lưu để bạn tiếp tục sử dụng ở những lần đăng nhập sau. Chỉ tải lên dữ liệu của chính bạn hoặc dữ liệu mà bạn có quyền sử dụng."]
          }
        ]
      },
      {
        id: "quyen-truy-cap",
        label: "Hồ sơ của bạn và người hỗ trợ",
        sections: [
          {
            title: "Thông tin của bạn",
            paragraphs: ["Bạn có thể xem hồ sơ, cập nhật các trường thông tin cá nhân được phép chỉnh sửa và xóa bảng điểm đã import tại phần Hồ sơ và bảng điểm. Thông tin định danh gắn với tài khoản đăng nhập được quản lý theo tài khoản của trường."]
          },
          {
            title: "Ai có thể xem thông tin học tập?",
            paragraphs: ["Bạn xem hồ sơ và bảng điểm của chính mình trong cổng sinh viên. Giảng viên, cán bộ phụ trách và quản trị viên có thể xem thông tin học tập để hỗ trợ sinh viên và quản lý việc đào tạo.", "Nếu phát hiện thông tin không chính xác hoặc cần hỗ trợ về dữ liệu cá nhân, hãy liên hệ cán bộ phụ trách của Khoa Công nghệ Thông tin để được hướng dẫn."]
          }
        ]
      },
      {
        id: "bao-ve",
        label: "Bảo vệ tài khoản và phiên đăng nhập",
        sections: [
          {
            title: "Đăng nhập Microsoft",
            paragraphs: ["Việc nhập mật khẩu được thực hiện trên trang xác thực của Microsoft. EduPath AI không cung cấp ô nhập hoặc lưu mật khẩu Microsoft của bạn. Không chia sẻ tài khoản, mã xác thực hoặc phiên đăng nhập với người khác."]
          },
          {
            title: "Sử dụng thiết bị chung",
            paragraphs: ["Hệ thống sử dụng phiên đăng nhập để xác định người dùng khi truy cập các chức năng cần xác thực. Sau khi sử dụng trên máy tính chung, hãy đăng xuất và đóng các cửa sổ đang hiển thị hồ sơ hoặc bảng điểm của bạn."]
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
            paragraphs: ["Sử dụng tài khoản Microsoft của chính bạn và bảo vệ thông tin đăng nhập. Không dùng tài khoản của người khác hoặc tìm cách truy cập dữ liệu, chức năng ngoài quyền được cấp. Cán bộ và giảng viên chỉ sử dụng dữ liệu phục vụ công việc được giao."]
          }
        ]
      },
      {
        id: "noi-dung",
        label: "Dữ liệu và nội dung cung cấp",
        sections: [
          {
            title: "Thông tin bạn tải lên",
            paragraphs: ["Bạn chịu trách nhiệm kiểm tra thông tin hồ sơ và bảng điểm đã tải lên. Không cung cấp tệp chứa nội dung giả mạo, mã độc hoặc dữ liệu cá nhân của người khác khi chưa có quyền sử dụng. Khi phát hiện sai sót trong kết quả đọc bảng điểm, hãy kiểm tra lại tệp nguồn và liên hệ cán bộ phụ trách nếu cần."]
          },
          {
            title: "Dữ liệu đào tạo và nghề nghiệp",
            paragraphs: ["Chương trình đào tạo, kế hoạch đào tạo, tiêu chuẩn xét tốt nghiệp và yêu cầu nghề nghiệp được quản lý trên hệ thống theo từng phiên bản. Khi sử dụng, hãy đối chiếu đúng khóa, ngành và chuyên ngành; ưu tiên thông báo và tài liệu chính thức của nhà trường nếu có khác biệt."]
          }
        ]
      },
      {
        id: "ket-qua",
        label: "Kết quả phân tích và hỗ trợ",
        sections: [
          {
            title: "Kết quả học tập và xét điều kiện",
            paragraphs: ["Các dấu đạt, chưa đạt và thông báo xét điều kiện được tạo từ dữ liệu đang có trên hệ thống. Kết quả có thể thay đổi khi bạn cập nhật bảng điểm hoặc khi tiêu chuẩn được điều chỉnh. Thông báo trên EduPath AI hỗ trợ bạn tự đối chiếu; kết quả xét tốt nghiệp chính thức do nhà trường công bố."]
          },
          {
            title: "Định hướng và trợ giúp",
            paragraphs: ["Mục tiêu nghề nghiệp và các gợi ý học tập là thông tin tham khảo để bạn chủ động chuẩn bị. Trao đổi với giảng viên hoặc cố vấn học tập trước những quyết định quan trọng. Nếu gặp vấn đề khi sử dụng, xem Câu hỏi thường gặp hoặc liên hệ cán bộ phụ trách của Khoa Công nghệ Thông tin."]
          }
        ]
      }
    ]
  }
};
