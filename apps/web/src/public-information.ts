export const publicInformationLinks = [
  { href: "/chinh-sach-va-dieu-khoan", label: "Chính sách & Điều khoản" },
  { href: "/cau-hoi-thuong-gap", label: "Câu hỏi thường gặp" }
] as const;

export const supportEmail = "hotrosinhvien@vlu.edu.vn";

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
      "Nếu mới bắt đầu, bạn nên kiểm tra thông tin khóa học, lớp học trong hồ sơ rồi tải bảng điểm lên. Từ đó, khi xem chương trình đào tạo hoặc kế hoạch đào tạo, bạn sẽ thấy kết quả của các môn đã có trong bảng điểm. Bạn cũng có thể tìm hiểu các vị trí nghề nghiệp, chọn một mục tiêu phù hợp với sở thích của mình, rồi dùng Đánh giá năng lực để biết kỹ năng hiện tại đã đáp ứng yêu cầu của nghề đó đến đâu."
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
      "Bạn có thể xem và cập nhật hồ sơ, tải bảng điểm PDF, tra cứu chương trình đào tạo, xem kế hoạch đào tạo theo năm học và học kỳ, đối chiếu những nhóm môn cần hoàn thành để xét tốt nghiệp, đồng thời đánh giá năng lực của mình so với nghề mục tiêu.",
      "Sau khi có bảng điểm, cột Kết quả trong chương trình và kế hoạch đào tạo giúp bạn nhận ra môn đã đạt hoặc chưa đạt. Trong phần điều kiện xét tốt nghiệp, bạn có thể xem tiến độ của từng nhóm và số tín chỉ đã đạt. Với nghề nghiệp, bạn có thể xem lĩnh vực, vị trí, yêu cầu kỹ năng và chọn mục tiêu trong Thông tin cá nhân.",
      "Trong Đánh giá năng lực, bạn xem được điểm từng kỹ năng và nhóm kỹ năng, mức phù hợp với nghề mục tiêu, những kỹ năng còn thiếu và học phần nên ưu tiên, kèm nhận xét do AI viết để tham khảo."
    ],
    note: "Bạn nên bắt đầu ở Hồ sơ và bảng điểm, sau đó lần lượt xem Chương trình đào tạo, Kế hoạch đào tạo và Điều kiện xét tốt nghiệp. Những mục đang được phát triển sẽ có thông báo ngay trên màn hình."
  },
  {
    question: "EduPath AI dùng AI vào việc gì?",
    answer: [
      "EduPath AI dùng mô hình ngôn ngữ Gemma 4 E4B để viết nhận xét học tập trong trang Đánh giá năng lực. Nhận xét giúp bạn hiểu kết quả của mình: điểm mạnh nằm ở đâu, kỹ năng nào còn thiếu so với nghề mục tiêu, nên ưu tiên học phần nào trong danh sách hệ thống gợi ý và nên tự học thêm những gì.",
      "Mọi con số như điểm kỹ năng, mức năng lực, khoảng trống kỹ năng và mức phù hợp nghề đều do hệ thống tính theo trọng số học phần mà Khoa cấu hình, không do AI đưa ra. Mô hình chạy cục bộ trên một máy tính do nhóm phát triển EduPath AI quản lý, nên dữ liệu của bạn không được gửi tới dịch vụ AI đám mây nào."
    ],
    note: "Nhận xét do AI viết chỉ để tham khảo và có thể chưa chính xác. Hãy đối chiếu với số liệu trên trang và trao đổi với giảng viên hoặc cố vấn học tập trước khi quyết định."
  },
  {
    question: "Làm thế nào để import bảng điểm của tôi?",
    answer: ["Hãy tải bảng điểm dưới dạng PDF từ cổng đào tạo của trường. Tệp cần có dung lượng tối đa 5 MB, không quá 20 trang và không được khóa bằng mật khẩu; bản PDF xuất trực tiếp sẽ dễ đọc hơn ảnh chụp hoặc bản scan."],
    steps: [
      "Đăng nhập EduPath AI và mở Hồ sơ và bảng điểm.",
      "Ở phần Bảng điểm của tôi, chọn hoặc kéo thả tệp PDF bảng điểm của bạn vào vùng tải lên.",
      "Tích ô xác nhận đây là bảng điểm của bạn và đồng ý để EduPath AI xử lý bảng điểm, bấm Import bảng điểm (hoặc Cập nhật bảng điểm nếu đã có bản cũ) và theo dõi thanh tiến trình cho đến khi có thông báo đã lưu.",
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
      "Điểm chữ MT (miễn thi) được tính là đã đạt, kể cả khi không có điểm số hệ 10 hoặc hệ 4. Khi một môn có nhiều lần học trong bảng điểm, chỉ cần có một lần đạt hoặc được miễn thi thì môn đó được đánh dấu đạt.",
      "Nếu ô Kết quả trong bảng điểm PDF để trống, EduPath AI suy ra kết quả từ điểm chữ: từ A+ đến D là đạt, F là chưa đạt. Những môn này có ghi chú là kết quả được suy ra từ điểm chữ."
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
      "Bấm Xem yêu cầu ở một vị trí nếu muốn đọc mô tả và các yêu cầu của nghề đó.",
      "Chọn vị trí trong danh sách rồi bấm Lưu, hoặc bấm Chọn làm mục tiêu nghề nghiệp khi đang xem yêu cầu. Mục tiêu được lưu ngay và hiển thị lại trong hồ sơ."
    ],
    note: "Bạn có thể chọn một mục tiêu khác khi định hướng thay đổi. Dùng nút Xem yêu cầu cạnh mục tiêu để đọc lại yêu cầu của nghề đang chọn. Nếu muốn bỏ chọn, bấm Chỉnh sửa thông tin, bấm nút Bỏ chọn cạnh mục tiêu rồi bấm Lưu thay đổi."
  },
  {
    question: "Làm thế nào để đánh giá năng lực?",
    answer: ["Đánh giá năng lực dựa trên bảng điểm bạn đã tải lên, cùng chuyên ngành và nghề mục tiêu trong hồ sơ. Bạn vẫn đánh giá được khi chưa chọn chuyên ngành hoặc nghề mục tiêu, nhưng kết quả sẽ đầy đủ hơn khi đã chọn."],
    steps: [
      "Tải bảng điểm PDF lên ở Hồ sơ và bảng điểm, nếu bạn chưa có bảng điểm trên EduPath AI.",
      "Trong Thông tin cá nhân, chọn chuyên ngành và vị trí nghề nghiệp mong muốn.",
      "Mở trang Đánh giá năng lực và bấm nút Đánh giá năng lực.",
      "Ở lần đầu, đọc phần giải thích về cách xử lý dữ liệu, tích ô đồng ý rồi xác nhận. Kết quả tính toán hiện ngay, còn nhận xét AI được tạo sau và có thể mất vài phút."
    ],
    note: "Khi đổi chuyên ngành hoặc nghề mục tiêu, hãy bấm Đánh giá lại để cập nhật kết quả. Khi bạn thay bảng điểm mới, kết quả cũ bị xóa và bạn cần đánh giá lại."
  },
  {
    question: "Điểm năng lực được tính như thế nào?",
    answer: [
      "Mỗi học phần rèn luyện một số kỹ năng ở những mức độ khác nhau, và Khoa cấu hình mức độ đó thành trọng số cho từng cặp học phần và kỹ năng. Điểm một kỹ năng là trung bình có trọng số của điểm các học phần liên quan mà bạn đã học, quy về thang 100: học phần càng nhiều tín chỉ và càng rèn luyện kỹ năng đó nhiều thì càng ảnh hưởng lớn đến điểm. Nếu một môn học nhiều lần, hệ thống dùng lần đạt có điểm cao nhất; môn có điểm MT được tính là đã học nhưng không đưa vào điểm trung bình.",
      "Từ điểm kỹ năng, hệ thống xếp mức: từ 85 trở lên là Thành thạo, từ 70 đến dưới 85 là Khá, từ 50 đến dưới 70 là Cơ bản và dưới 50 là Cần củng cố. Điểm nhóm kỹ năng được tính theo cùng cách, còn điểm tổng là trung bình của các nhóm có dữ liệu; Giáo dục thể chất và Giáo dục quốc phòng không tính vào hai điểm này. Với nghề mục tiêu, mỗi kỹ năng yêu cầu được so với ngưỡng 70 nếu là kỹ năng Ưu tiên và 85 nếu là kỹ năng Bắt buộc."
    ],
    note: "Kỹ năng mà bạn chưa học học phần liên quan nào được ghi là Chưa có minh chứng, còn kỹ năng nghề mà chương trình đào tạo chưa có học phần đo được ghi là Chưa đủ dữ liệu. Cả hai trường hợp đều không có nghĩa là bạn yếu kỹ năng đó."
  },
  {
    question: "Mô hình AI nhận những dữ liệu nào của tôi?",
    answer: [
      "Để viết nhận xét, mô hình chỉ nhận mã và tên học phần theo chương trình đào tạo, điểm của bạn ở các học phần đó, khóa, chuyên ngành, nghề mục tiêu và các kết quả hệ thống đã tính như điểm kỹ năng, khoảng trống và học phần gợi ý.",
      "Mô hình không nhận họ tên, mã số sinh viên, email, lớp, sở thích hay tệp PDF bảng điểm của bạn. Mô hình chạy cục bộ trên máy tính do nhóm phát triển EduPath AI quản lý, nhận yêu cầu qua một kênh có xác thực, và dữ liệu không được gửi tới dịch vụ AI đám mây nào."
    ],
    note: "Dữ liệu gửi cho mô hình được xóa sau khi xử lý xong; chỉ nhận xét được lưu lại cùng kết quả đánh giá. Chi tiết xem mục Đánh giá năng lực và AI trong Chính sách bảo mật."
  },
  {
    question: "Nhận xét từ AI có thay thế tư vấn của giảng viên không?",
    answer: [
      "Không. Kết quả đánh giá năng lực và nhận xét từ AI giúp bạn chuẩn bị phương án và có thêm thông tin để trao đổi với giảng viên hoặc cố vấn học tập. Quyết định đăng ký môn, đổi kế hoạch hay định hướng chuyên ngành vẫn nên dựa trên chương trình đào tạo và thông báo của trường.",
      "Ví dụ, trước khi dự định học một môn được gợi ý vào học kỳ tới, hãy kiểm tra môn tiên quyết, môn phải học trước và việc môn đó có được mở trong đợt đăng ký hay không. Nếu đang phân vân giữa nhiều hướng nghề nghiệp, bạn có thể xem yêu cầu của từng vị trí để chuẩn bị câu hỏi cụ thể cho giảng viên."
    ]
  },
  {
    question: "Làm thế nào để xóa kết quả đánh giá năng lực?",
    answer: [
      "Trên trang Đánh giá năng lực, bạn có thể rút lại sự đồng ý cho việc đánh giá năng lực. Khi đó, toàn bộ kết quả đánh giá và nhận xét AI của bạn bị xóa; hồ sơ và bảng điểm vẫn được giữ. Nếu muốn đánh giá lại sau này, bạn cần đồng ý lại.",
      "Kết quả đánh giá cũng bị xóa khi bạn xóa bảng điểm hoặc khi bảng điểm mới thay thế bản cũ, vì kết quả được tính từ bảng điểm đó. Ngoài ra, EduPath AI chỉ giữ tối đa 20 lần đánh giá gần nhất của bạn."
    ],
    note: "Kết quả đánh giá đã xóa không khôi phục được."
  },
  {
    question: "Vì sao hồ sơ đã có sẵn họ tên, mã sinh viên, khóa và lớp?",
    answer: [
      "Khi bạn đăng nhập lần đầu, EduPath AI lấy họ tên, mã sinh viên, khóa, lớp và năm nhập học từ tài khoản Microsoft do trường cấp rồi điền sẵn vào hồ sơ, để bạn không phải nhập lại.",
      "Những thông tin này gắn với tài khoản trường nên chỉ hiển thị để bạn kiểm tra, không chỉnh sửa trực tiếp trên EduPath AI. Điều này giúp tránh việc nhập nhầm mã sinh viên hoặc dùng mã của người khác."
    ],
    note: `Nếu họ tên, mã sinh viên, khóa hoặc lớp bị sai hay để trống, hãy gửi email đến ${supportEmail} để được kiểm tra.`
  },
  {
    question: "Tôi có thể chỉnh sửa hoặc xóa dữ liệu đã nhập không?",
    answer: [
      "Bạn có thể mở Thông tin cá nhân, chọn Chỉnh sửa thông tin để cập nhật Sở thích, Chuyên ngành và Vị trí nghề nghiệp mong muốn, rồi bấm Lưu thay đổi. Lớp học và các thông tin định danh lấy từ tài khoản trường chỉ để xem.",
      "Để xóa bảng điểm, mở Hồ sơ và bảng điểm, bấm Xóa bảng điểm và xác nhận. Việc này xóa PDF, toàn bộ dữ liệu môn học đã import và các kết quả đánh giá năng lực; thông tin cá nhân vẫn được giữ lại. Sau đó bạn có thể tải một bảng điểm mới lên."
    ],
    note: `Sau khi xóa bảng điểm, cột Kết quả và phần xét tốt nghiệp sẽ không còn dấu đạt hoặc chưa đạt cho đến khi bạn import lại. Nếu muốn xóa toàn bộ tài khoản EduPath AI hoặc nhận bản sao dữ liệu của mình, hãy gửi email đến ${supportEmail}.`
  },
  {
    question: "Ai có thể xem bảng điểm và thông tin cá nhân của tôi?",
    answer: [
      "Chỉ bạn xem được tệp bảng điểm, điểm, kết quả từng môn và kết quả đánh giá năng lực khi đăng nhập bằng tài khoản của mình. Sinh viên khác không xem được hồ sơ hay bảng điểm của bạn.",
      "Trong nhà trường, chỉ cán bộ, giảng viên có nhiệm vụ liên quan mới được xem những thông tin hồ sơ cần thiết để hỗ trợ học tập và quản lý đào tạo. Những thông tin này không bao gồm điểm số hay kết quả đánh giá năng lực của bạn."
    ],
    note: "EduPath AI không bán dữ liệu, không dùng thông tin của bạn để quảng cáo và không cung cấp cho bên ngoài nhà trường vì mục đích thương mại. Chi tiết xem mục Chia sẻ thông tin trong Chính sách bảo mật."
  },
  {
    question: "Bảng điểm PDF của tôi được lưu và xử lý như thế nào?",
    answer: [
      "Sau khi bạn tải lên, EduPath AI tự động đọc tệp PDF để lấy danh sách môn học, tín chỉ, điểm và kết quả theo từng học kỳ. Tệp chỉ dùng để tạo bảng điểm trong tài khoản của bạn và không được gửi cho dịch vụ AI hay đơn vị nào bên ngoài.",
      "Mỗi tài khoản lưu một bảng điểm. Bảng điểm được giữ đến khi bạn thay bằng bản mới, bấm Xóa bảng điểm hoặc khi tài khoản được xóa.",
      "Nếu bạn dùng Đánh giá năng lực, phần dữ liệu từ bảng điểm gửi cho mô hình AI viết nhận xét chỉ gồm mã học phần, tên học phần theo chương trình đào tạo và điểm, không gồm tệp PDF."
    ],
    note: "Việc đọc tự động có thể nhầm, nhất là với ảnh chụp hoặc bản scan. Hãy đối chiếu kết quả với bảng điểm gốc và luôn tự giữ bản PDF của mình."
  },
  {
    question: "Vì sao tôi bị đăng xuất hoặc không vào được cổng sinh viên?",
    answer: [
      "Để bảo vệ tài khoản, phiên đăng nhập tự kết thúc sau một thời gian không sử dụng. Khi đó bạn chỉ cần đăng nhập lại bằng tài khoản trường.",
      "Nếu thấy thông báo trang này dành riêng cho sinh viên, tài khoản bạn vừa dùng không phải tài khoản sinh viên. Hãy chọn Đăng nhập bằng tài khoản sinh viên khác và dùng email @vanlanguni.vn của bạn."
    ],
    note: `Nếu đã đăng nhập lại mà vẫn không vào được, hãy gửi email đến ${supportEmail}.`
  },
  {
    question: "Tôi có thể dùng EduPath AI trên điện thoại không?",
    answer: ["Có. EduPath AI là trang web, bạn mở bằng trình duyệt trên máy tính hoặc điện thoại mà không cần cài thêm ứng dụng. Với các bảng dài như bảng điểm hay chương trình đào tạo, màn hình máy tính sẽ dễ theo dõi hơn."],
    note: "Nếu dùng điện thoại hoặc máy tính chung, hãy bấm Đăng xuất sau khi sử dụng."
  },
  {
    question: "Sau khi tốt nghiệp, dữ liệu của tôi trên EduPath AI sẽ ra sao?",
    answer: [`Dữ liệu của bạn được giữ cho đến khi bạn tự xóa bảng điểm hoặc đề nghị xóa tài khoản. Nếu không còn sử dụng EduPath AI, bạn nên xóa bảng điểm và gửi email đến ${supportEmail} để đề nghị xóa tài khoản.`],
    note: "Bảng điểm đã xóa không khôi phục được, vì vậy hãy tự giữ bản PDF gốc trước khi xóa."
  },
  {
    question: "Tôi muốn góp ý hoặc báo lỗi thì liên hệ ở đâu?",
    answer: [`Hãy gửi email đến ${supportEmail} từ email trường của bạn. Mô tả ngắn gọn bạn đang dùng chức năng nào, đã làm những bước gì và thông báo lỗi hiển thị trên màn hình.`],
    note: "Nếu gửi kèm ảnh chụp màn hình, hãy che các thông tin không cần thiết và không chụp thông tin của người khác."
  }
];

// Students consent to this policy version when importing a transcript or requesting a competency
// assessment; the API rejects any other version. Must equal TRANSCRIPT_POLICY_VERSION in
// apps/api/src/student/consent.ts.
export const policyVersion = "2026-10-11";
export const policyUpdatedAt = policyVersion.split("-").reverse().join("/");

// Privacy category that explains competency assessment and the AI commentary. The consent dialog on
// the competency page links here; PublicInformationPage renders privacy categories as #bao-mat-<id>.
export const competencyPolicyCategoryId = "danh-gia-nang-luc";
export const competencyPolicyHref = `${publicInformationLinks[0].href}#bao-mat-${competencyPolicyCategoryId}`;

// A string renders as a paragraph; a string array renders as a bullet list.
type InformationSection = { title: string; paragraphs: (string | string[])[] };
type InformationCategory = { id: string; label: string; sections: InformationSection[] };
export type PolicyKind = "privacy" | "terms";

export const informationPolicies: Record<PolicyKind, { title: string; categories: InformationCategory[] }> = {
  privacy: {
    title: "Chính sách bảo mật",
    categories: [
      {
        id: "tong-quan",
        label: "Giới thiệu chung",
        sections: [
          {
            title: "Chính sách này dành cho ai?",
            paragraphs: [
              "Chính sách bảo mật này dành cho sinh viên sử dụng EduPath AI, công cụ hỗ trợ học tập và định hướng nghề nghiệp do Khoa Công nghệ Thông tin, Trường Đại học Văn Lang (gọi tắt là Khoa) vận hành.",
              "Chính sách cho bạn biết EduPath AI thu thập những thông tin nào, dùng vào việc gì, ai được xem, lưu trữ trong bao lâu và bạn có những quyền gì đối với dữ liệu của mình."
            ]
          },
          {
            title: "Những điểm chính",
            paragraphs: [[
              "Bạn đăng nhập bằng tài khoản Microsoft của trường. EduPath AI không biết và không lưu mật khẩu của bạn.",
              "Chỉ bạn xem được bảng điểm, điểm từng môn và kết quả đánh giá năng lực của mình.",
              "Sở thích, chuyên ngành, mục tiêu nghề nghiệp và bảng điểm do bạn tự nguyện cung cấp, và bạn có thể sửa hoặc xóa bất cứ lúc nào.",
              "Đánh giá năng lực chỉ chạy khi bạn yêu cầu và đồng ý. Điểm và mức năng lực do hệ thống tính; AI chỉ viết nhận xét để bạn tham khảo.",
              "Mô hình AI viết nhận xét chạy cục bộ, không nhận họ tên, mã số sinh viên, email, lớp hay tệp PDF bảng điểm của bạn, và dữ liệu không được gửi tới dịch vụ AI đám mây.",
              "EduPath AI không bán dữ liệu, không hiển thị quảng cáo và không theo dõi bạn trên các trang web khác.",
              "Dữ liệu được lưu trên dịch vụ lưu trữ đám mây, máy chủ có thể đặt ngoài Việt Nam."
            ]]
          },
          {
            title: "Căn cứ pháp lý",
            paragraphs: [
              "Chính sách được xây dựng theo Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 và Nghị định số 356/2025/NĐ-CP quy định chi tiết luật này, cùng có hiệu lực từ ngày 01/01/2026.",
              "Chính sách chỉ áp dụng cho EduPath AI. Tài khoản Microsoft của trường và các hệ thống khác của nhà trường, như cổng đào tạo, thực hiện theo quy định riêng của từng hệ thống."
            ]
          }
        ]
      },
      {
        id: "thong-tin",
        label: "Thông tin được thu thập",
        sections: [
          {
            title: "Thông tin từ tài khoản trường",
            paragraphs: ["Khi bạn đăng nhập, EduPath AI nhận từ tài khoản Microsoft do trường cấp các thông tin: họ tên, email trường, mã số sinh viên, khóa, lớp và năm nhập học. Những thông tin này được điền sẵn vào hồ sơ để bạn không phải nhập lại."]
          },
          {
            title: "Thông tin bạn tự cung cấp",
            paragraphs: [
              [
                "Sở thích, chuyên ngành và vị trí nghề nghiệp mong muốn mà bạn nhập hoặc chọn trong hồ sơ.",
                "Bảng điểm PDF bạn tải lên, cùng các thông tin đọc được từ đó: môn học, số tín chỉ, điểm, kết quả và học kỳ."
              ],
              "Các thông tin này không bắt buộc. Khi chưa tải bảng điểm lên, bạn vẫn dùng được các chức năng khác, chỉ chưa thấy kết quả đạt hay chưa đạt của từng môn và chưa dùng được Đánh giá năng lực."
            ]
          },
          {
            title: "Thông tin được tạo khi bạn đánh giá năng lực",
            paragraphs: ["Mỗi lần bạn đánh giá năng lực, EduPath AI tạo và lưu một kết quả đánh giá từ bảng điểm và hồ sơ của bạn, gồm điểm và mức của từng kỹ năng, nhóm kỹ năng, mức phù hợp với nghề mục tiêu, các khoảng trống kỹ năng, học phần nên ưu tiên, tiến độ so với kế hoạch đào tạo và điều kiện xét tốt nghiệp, cùng nhận xét do AI viết nếu có."]
          },
          {
            title: "Thông tin ghi nhận khi bạn sử dụng",
            paragraphs: [[
              "Thời điểm và kết quả các lần đăng nhập, để bảo vệ tài khoản và hỗ trợ bạn khi gặp sự cố đăng nhập.",
              "Thời điểm bạn đồng ý hoặc rút lại sự đồng ý cho việc xử lý bảng điểm và cho việc đánh giá năng lực, cùng phiên bản chính sách bạn đã đồng ý."
            ]]
          },
          {
            title: "Thông tin không thu thập",
            paragraphs: [
              "EduPath AI không yêu cầu bạn cung cấp:",
              [
                "Mật khẩu tài khoản trường.",
                "Số căn cước, số điện thoại, địa chỉ nhà hay thông tin tài khoản ngân hàng.",
                "Thông tin sức khỏe, tôn giáo, quan điểm chính trị hay vị trí của bạn."
              ],
              "Vì vậy, bạn cũng không nên ghi những thông tin này vào ô Sở thích."
            ]
          }
        ]
      },
      {
        id: "muc-dich",
        label: "Mục đích sử dụng",
        sections: [
          {
            title: "Thông tin của bạn được dùng để làm gì?",
            paragraphs: [[
              "Đăng nhập và hiển thị hồ sơ của bạn.",
              "Hiển thị bảng điểm và đánh dấu các môn đã đạt, chưa đạt trong chương trình và kế hoạch đào tạo.",
              "Giúp bạn tự kiểm tra tiến độ so với điều kiện xét tốt nghiệp.",
              "Giúp bạn tìm hiểu các vị trí nghề nghiệp và lưu mục tiêu của mình.",
              "Đánh giá năng lực và phân tích khoảng trống kỹ năng so với nghề mục tiêu, khi bạn yêu cầu.",
              "Tạo nhận xét học tập bằng AI cho kết quả đánh giá năng lực của bạn.",
              "Giúp Khoa hỗ trợ, tư vấn học tập và quản lý đào tạo.",
              "Bảo vệ tài khoản và xử lý khi có sự cố."
            ]]
          },
          {
            title: "Sự đồng ý của bạn",
            paragraphs: [
              "Thông tin từ tài khoản trường là cần thiết để bạn đăng nhập và sử dụng EduPath AI. Sở thích, chuyên ngành, mục tiêu nghề nghiệp và bảng điểm chỉ được xử lý khi chính bạn nhập hoặc tải lên.",
              "Trước khi tải bảng điểm lên, bạn cần tích ô xác nhận đây là bảng điểm của mình và đồng ý để EduPath AI xử lý bảng điểm theo chính sách này. Ô này không được chọn sẵn; nếu bạn không tích, bảng điểm sẽ không được tải lên.",
              "Đánh giá năng lực cần một sự đồng ý riêng. Lần đầu bạn bấm Đánh giá năng lực, EduPath AI sẽ hỏi bạn có đồng ý cho việc đánh giá năng lực và tạo nhận xét bằng AI theo chính sách này hay không; nếu bạn không đồng ý, việc đánh giá sẽ không được thực hiện. Chi tiết xem mục Đánh giá năng lực và AI.",
              "EduPath AI lưu lại thời điểm bạn đồng ý và phiên bản chính sách bạn đã đồng ý, để làm bằng chứng theo quy định của pháp luật. Khi chính sách được cập nhật, bạn sẽ được đề nghị đồng ý lại ở lần tải bảng điểm hoặc lần đánh giá năng lực tiếp theo.",
              "Bạn có thể rút lại sự đồng ý bất cứ lúc nào bằng cách xóa bảng điểm hoặc xóa thông tin đã nhập. Với đánh giá năng lực, bạn rút lại sự đồng ý ngay trên trang Đánh giá năng lực, và toàn bộ kết quả đánh giá sẽ bị xóa. Thời điểm rút lại cũng được ghi nhận. Việc rút lại không ảnh hưởng đến tính hợp pháp của việc xử lý đã diễn ra trước đó."
            ]
          },
          {
            title: "Những điều EduPath AI không làm",
            paragraphs: [[
              "Không bán, cho thuê hay trao đổi dữ liệu cá nhân của bạn.",
              "Không dùng dữ liệu của bạn để quảng cáo.",
              "Không gửi bảng điểm hay dữ liệu học tập của bạn tới dịch vụ AI đám mây hay đơn vị nào bên ngoài để đọc hoặc phân tích.",
              "Không đưa họ tên, mã số sinh viên, email, lớp hay tệp PDF bảng điểm của bạn vào dữ liệu gửi cho mô hình AI viết nhận xét.",
              "Không dùng dữ liệu của bạn cho mục đích khác khi chưa thông báo cho bạn."
            ]]
          }
        ]
      },
      {
        id: "bang-diem",
        label: "Bảng điểm của bạn",
        sections: [
          {
            title: "Bảng điểm được đọc như thế nào?",
            paragraphs: [
              "Sau khi bạn tải lên, EduPath AI tự động đọc tệp PDF để lấy danh sách môn học, số tín chỉ, điểm và kết quả theo từng học kỳ. Tệp chỉ được dùng để tạo bảng điểm trong tài khoản của bạn.",
              "Việc đọc tự động có thể nhầm, nhất là với ảnh chụp hoặc bản scan. Hãy đối chiếu kết quả với bảng điểm gốc sau mỗi lần tải lên."
            ]
          },
          {
            title: "Ai xem được bảng điểm của bạn?",
            paragraphs: ["Chỉ bạn xem được tệp bảng điểm, điểm và kết quả từng môn khi đăng nhập bằng tài khoản của mình. Sinh viên khác không xem được bảng điểm của bạn."]
          },
          {
            title: "Lưu, thay thế và xóa bảng điểm",
            paragraphs: [
              [
                "Mỗi tài khoản chỉ lưu một bảng điểm. Khi bạn tải bản mới lên và đọc thành công, bản cũ được thay thế.",
                "Bảng điểm được giữ đến khi bạn xóa, thay bằng bản mới hoặc khi tài khoản được xóa.",
                "Khi bạn bấm Xóa bảng điểm, tệp PDF và toàn bộ điểm đã đọc bị xóa; thông tin hồ sơ vẫn được giữ.",
                "Khi bảng điểm bị xóa hoặc được thay bằng bản mới, mọi kết quả đánh giá năng lực tính từ bảng điểm cũ cũng bị xóa."
              ],
              "Bảng điểm đã xóa không khôi phục được, vì vậy hãy luôn tự giữ bản PDF gốc."
            ]
          }
        ]
      },
      {
        id: competencyPolicyCategoryId,
        label: "Đánh giá năng lực và AI",
        sections: [
          {
            title: "Đánh giá năng lực dùng những dữ liệu nào?",
            paragraphs: [
              "Khi bạn bấm Đánh giá năng lực, EduPath AI dùng các thông tin sau để tính kết quả:",
              [
                "Điểm và kết quả các học phần trong bảng điểm bạn đã tải lên.",
                "Khóa, chuyên ngành và vị trí nghề nghiệp mong muốn trong hồ sơ của bạn.",
                "Chương trình đào tạo, kế hoạch đào tạo và tiêu chuẩn xét tốt nghiệp của khóa bạn, cùng yêu cầu kỹ năng của nghề mục tiêu.",
                "Trọng số học phần do Khoa cấu hình, cho biết mỗi học phần rèn luyện từng kỹ năng ở mức nào."
              ],
              "Việc đánh giá chỉ chạy khi bạn yêu cầu; tải bảng điểm lên không tự động tạo kết quả đánh giá."
            ]
          },
          {
            title: "Kết quả được tính như thế nào?",
            paragraphs: [
              "Điểm kỹ năng, mức năng lực, khoảng trống kỹ năng và mức phù hợp với nghề mục tiêu đều do hệ thống tính theo trọng số học phần do Khoa cấu hình. AI không tính và không thay đổi các con số này. Cách tính và các ngưỡng được giải thích ngay trên trang Đánh giá năng lực.",
              "Nếu chương trình đào tạo chưa có học phần nào đo một kỹ năng mà nghề mục tiêu yêu cầu, kỹ năng đó được ghi là Chưa đủ dữ liệu. Điều này không có nghĩa là bạn yếu kỹ năng đó."
            ]
          },
          {
            title: "Về các tính năng AI",
            paragraphs: [
              "Sau khi hệ thống tính xong, EduPath AI tạo thêm một nhận xét học tập bằng mô hình ngôn ngữ Gemma 4 E4B. Nhận xét giúp bạn hiểu kết quả của mình: điểm mạnh nằm ở đâu, khoảng trống nào cần ưu tiên so với nghề mục tiêu, nên chọn học phần nào trong danh sách do hệ thống đưa ra và nên tự học thêm những gì.",
              "Mô hình chạy cục bộ trên một máy tính do nhóm phát triển EduPath AI quản lý. Máy này nhận yêu cầu từ EduPath AI qua một kênh có xác thực; dữ liệu của bạn không được gửi tới bất kỳ dịch vụ AI đám mây nào.",
              "Nhận xét chỉ mang tính tham khảo và có thể chưa chính xác. Quyết định học tập vẫn thuộc về bạn, cùng với giảng viên và cố vấn học tập; hãy đối chiếu với số liệu trên trang trước khi quyết định.",
              "Khi máy chạy mô hình chưa sẵn sàng, bạn vẫn xem được đầy đủ kết quả do hệ thống tính, chỉ chưa có phần nhận xét."
            ]
          },
          {
            title: "Mô hình AI nhận những dữ liệu nào?",
            paragraphs: [
              "Để viết nhận xét, mô hình chỉ nhận:",
              [
                "Mã và tên học phần theo chương trình đào tạo, cùng điểm của bạn ở các học phần đó.",
                "Khóa, chuyên ngành và nghề mục tiêu của bạn.",
                "Các kết quả hệ thống đã tính, như điểm và mức kỹ năng, khoảng trống, học phần gợi ý, tiến độ học tập và cảnh báo dữ liệu."
              ],
              "Mô hình không nhận họ tên, mã số sinh viên, email, lớp, sở thích hay tệp PDF bảng điểm của bạn."
            ]
          },
          {
            title: "Khi nào bạn được hỏi ý kiến?",
            paragraphs: [
              "Đánh giá năng lực cần sự đồng ý riêng, tách biệt với sự đồng ý khi tải bảng điểm. Lần đầu bạn bấm Đánh giá năng lực, EduPath AI sẽ hỏi ý kiến của bạn; bạn cần tích ô đồng ý cho việc đánh giá năng lực và tạo nhận xét bằng AI theo chính sách này. Nếu bạn không đồng ý, việc đánh giá sẽ không được thực hiện.",
              "Khi chính sách được cập nhật, bạn sẽ được hỏi lại ở lần đánh giá tiếp theo. Thời điểm bạn đồng ý hoặc rút lại sự đồng ý, cùng phiên bản chính sách bạn đã đồng ý, đều được ghi nhận."
            ]
          },
          {
            title: "Lưu và xóa kết quả đánh giá",
            paragraphs: [
              [
                "Chỉ bạn xem được kết quả đánh giá và nhận xét AI của mình.",
                "Kết quả được lưu đến khi bạn xóa bảng điểm, thay bằng bảng điểm mới, rút lại sự đồng ý cho đánh giá năng lực hoặc khi tài khoản được xóa.",
                "Mỗi tài khoản giữ tối đa 20 lần đánh giá gần nhất; khi có lần đánh giá mới, lần cũ nhất vượt quá giới hạn này bị xóa.",
                "Dữ liệu gửi cho mô hình AI được xóa sau khi xử lý xong, kể cả khi việc tạo nhận xét bị lỗi hoặc bị hủy; nhận xét được lưu cùng kết quả đánh giá."
              ],
              "Bạn có thể rút lại sự đồng ý bất cứ lúc nào trên trang Đánh giá năng lực. Khi đó, toàn bộ kết quả đánh giá và nhận xét AI của bạn bị xóa và không khôi phục được; hồ sơ và bảng điểm vẫn được giữ."
            ]
          }
        ]
      },
      {
        id: "chia-se",
        label: "Chia sẻ thông tin",
        sections: [
          {
            title: "Ai có thể xem thông tin của bạn?",
            paragraphs: [
              "Bạn xem được toàn bộ thông tin của mình. Sinh viên khác không xem được hồ sơ, bảng điểm hay kết quả đánh giá năng lực của bạn.",
              "Trong nhà trường, chỉ cán bộ, giảng viên có nhiệm vụ liên quan mới được xem những thông tin hồ sơ cần thiết để hỗ trợ học tập và quản lý đào tạo, không bao gồm điểm số và kết quả đánh giá năng lực của bạn, và không được chia sẻ ra ngoài."
            ]
          },
          {
            title: "Đối tác cung cấp dịch vụ",
            paragraphs: [
              "Để EduPath AI hoạt động, nhà trường sử dụng dịch vụ của:",
              [
                "Microsoft: dịch vụ đăng nhập bằng tài khoản trường.",
                "Nhà cung cấp dịch vụ lưu trữ đám mây: nơi vận hành EduPath AI và lưu trữ dữ liệu."
              ],
              "Các đối tác này chỉ được xử lý dữ liệu trong phạm vi cần thiết để cung cấp dịch vụ cho nhà trường."
            ]
          },
          {
            title: "Máy tạo nhận xét AI",
            paragraphs: ["Nhận xét AI được tạo trên một máy tính do nhóm phát triển EduPath AI quản lý, bằng mô hình chạy ngay trên máy đó. Máy này chỉ nhận phần dữ liệu nêu ở mục Đánh giá năng lực và AI, không nhận họ tên, mã số sinh viên, email hay lớp của bạn, và không gửi dữ liệu tới dịch vụ AI đám mây."]
          },
          {
            title: "Khi pháp luật yêu cầu",
            paragraphs: ["Ngoài các trường hợp trên, thông tin của bạn chỉ được cung cấp cho cơ quan nhà nước có thẩm quyền khi pháp luật quy định, hoặc cho bên khác khi có sự đồng ý của bạn."]
          }
        ]
      },
      {
        id: "luu-tru",
        label: "Lưu trữ và bảo mật",
        sections: [
          {
            title: "Dữ liệu được lưu ở đâu?",
            paragraphs: [
              "Dữ liệu của bạn được lưu trên dịch vụ lưu trữ đám mây, và máy chủ có thể đặt ngoài lãnh thổ Việt Nam. Dù dữ liệu được lưu ở đâu, các cam kết và quyền của bạn trong chính sách này vẫn được giữ nguyên.",
              "Riêng phần dữ liệu dùng để tạo nhận xét AI được xử lý trên máy tính do nhóm phát triển EduPath AI quản lý và được xóa sau khi xử lý xong."
            ]
          },
          {
            title: "Dữ liệu được giữ trong bao lâu?",
            paragraphs: [
              [
                "Thông tin hồ sơ: trong thời gian tài khoản EduPath AI của bạn còn tồn tại.",
                "Bảng điểm: đến khi bạn xóa, thay bằng bản mới hoặc khi tài khoản được xóa.",
                "Kết quả đánh giá năng lực và nhận xét AI: đến khi bạn xóa hoặc thay bảng điểm, rút lại sự đồng ý cho đánh giá năng lực hoặc khi tài khoản được xóa; mỗi tài khoản giữ tối đa 20 lần đánh giá gần nhất.",
                "Dữ liệu gửi cho mô hình AI: được xóa sau khi xử lý xong.",
                "Lịch sử đăng nhập và lịch sử đồng ý: trong thời gian tài khoản còn tồn tại."
              ],
              `Khi không còn sử dụng EduPath AI, chẳng hạn sau khi tốt nghiệp, bạn có thể tự xóa bảng điểm và gửi email đến ${supportEmail} để đề nghị xóa tài khoản.`
            ]
          },
          {
            title: "Dữ liệu được bảo vệ thế nào?",
            paragraphs: [
              [
                "Chỉ tài khoản Microsoft của Trường Đại học Văn Lang mới đăng nhập được.",
                "Kết nối giữa trình duyệt và EduPath AI được mã hóa.",
                "Mỗi người chỉ được xem những thông tin phù hợp với nhiệm vụ của mình.",
                "Máy tạo nhận xét AI phải xác thực mới nhận được yêu cầu từ EduPath AI.",
                "Phiên đăng nhập tự kết thúc sau một thời gian không sử dụng.",
                "EduPath AI chỉ dùng cookie cần thiết để giữ đăng nhập, không dùng cookie quảng cáo hay công cụ theo dõi."
              ],
              "Không hệ thống nào an toàn tuyệt đối. Nếu xảy ra sự cố làm lộ hoặc mất dữ liệu, nhà trường sẽ khắc phục và thông báo theo quy định của pháp luật."
            ]
          }
        ]
      },
      {
        id: "quyen-cua-ban",
        label: "Quyền của bạn",
        sections: [
          {
            title: "Bạn có những quyền gì?",
            paragraphs: [
              "Theo Luật Bảo vệ dữ liệu cá nhân, bạn có quyền:",
              [
                "Được biết dữ liệu của mình được xử lý như thế nào.",
                "Đồng ý, không đồng ý hoặc rút lại sự đồng ý.",
                "Xem và chỉnh sửa dữ liệu của mình, hoặc yêu cầu chỉnh sửa.",
                "Yêu cầu cung cấp, xóa hoặc hạn chế xử lý dữ liệu, và phản đối việc xử lý.",
                "Khiếu nại, tố cáo, khởi kiện và yêu cầu bồi thường theo quy định của pháp luật.",
                "Yêu cầu áp dụng các biện pháp bảo vệ dữ liệu của mình."
              ]
            ]
          },
          {
            title: "Bạn tự thực hiện trên EduPath AI",
            paragraphs: [[
              "Xem hồ sơ và bảng điểm tại Hồ sơ và bảng điểm.",
              "Sửa sở thích, chọn chuyên ngành hoặc đổi mục tiêu nghề nghiệp trong Thông tin cá nhân.",
              "Thay bảng điểm bằng bản mới hoặc bấm Xóa bảng điểm.",
              "Xem kết quả đánh giá năng lực, hoặc rút lại sự đồng ý để xóa toàn bộ kết quả đánh giá, tại trang Đánh giá năng lực.",
              "Bấm Đăng xuất để kết thúc phiên đăng nhập trên thiết bị."
            ]]
          },
          {
            title: "Gửi yêu cầu qua email",
            paragraphs: [
              `Với các yêu cầu chưa tự làm được trên EduPath AI, bạn gửi email đến ${supportEmail}, ví dụ:`,
              [
                "Sửa họ tên, mã số sinh viên, khóa hoặc lớp bị sai.",
                "Nhận bản sao dữ liệu EduPath AI đang lưu về bạn.",
                "Xóa tài khoản cùng toàn bộ hồ sơ, bảng điểm, kết quả đánh giá năng lực và lịch sử liên quan.",
                "Hạn chế hoặc phản đối việc xử lý dữ liệu."
              ],
              "Hãy gửi từ email trường và ghi rõ họ tên, mã số sinh viên cùng nội dung yêu cầu. Yêu cầu của bạn được xử lý trong thời hạn pháp luật quy định; nếu chưa thể thực hiện, nhà trường sẽ cho bạn biết lý do."
            ]
          },
          {
            title: "Trách nhiệm của bạn",
            paragraphs: [[
              "Giữ bí mật mật khẩu và không cho người khác dùng tài khoản của mình.",
              "Cung cấp thông tin chính xác và chỉ tải lên bảng điểm của chính bạn.",
              "Tôn trọng dữ liệu của người khác: không tải lên, không ghi lại và không chia sẻ thông tin của sinh viên khác."
            ]]
          }
        ]
      },
      {
        id: "lien-he",
        label: "Liên hệ và cập nhật",
        sections: [
          {
            title: "Liên hệ và khiếu nại",
            paragraphs: [
              `Nếu có câu hỏi về dữ liệu cá nhân hoặc cho rằng quyền của mình chưa được bảo đảm, hãy gửi email đến ${supportEmail} để được giải đáp.`,
              "Bạn cũng có quyền khiếu nại, tố cáo đến cơ quan nhà nước có thẩm quyền theo quy định của pháp luật."
            ]
          },
          {
            title: "Cập nhật chính sách",
            paragraphs: [
              "Chính sách có thể được cập nhật khi EduPath AI thay đổi chức năng hoặc khi quy định pháp luật thay đổi. Nội dung mới được đăng tại trang này cùng ngày cập nhật.",
              "Nếu thay đổi ảnh hưởng đến cách dữ liệu của bạn được sử dụng, chẳng hạn khi có tính năng AI mới, bạn sẽ được hỏi ý kiến trước khi dữ liệu của mình được xử lý theo cách mới.",
              "Bản cập nhật ngày 11/10/2026 bổ sung tính năng Đánh giá năng lực, nhận xét học tập bằng AI và thông tin chuyên ngành trong hồ sơ."
            ]
          }
        ]
      }
    ]
  },
  terms: {
    title: "Điều khoản sử dụng",
    categories: [
      {
        id: "gioi-thieu",
        label: "Giới thiệu chung",
        sections: [
          {
            title: "EduPath AI là gì?",
            paragraphs: [
              "EduPath AI là công cụ hỗ trợ học tập do Khoa Công nghệ Thông tin, Trường Đại học Văn Lang vận hành cho sinh viên ngành Công nghệ Thông tin. Bạn có thể theo dõi kết quả học tập, đối chiếu chương trình và kế hoạch đào tạo, tự kiểm tra điều kiện xét tốt nghiệp, tìm hiểu các vị trí nghề nghiệp và đánh giá năng lực của mình so với nghề mục tiêu.",
              "EduPath AI giúp bạn chủ động hơn trong việc học, nhưng không thay thế cổng đào tạo, cố vấn học tập hay các thông báo chính thức của nhà trường."
            ]
          },
          {
            title: "Ai được sử dụng?",
            paragraphs: ["Sinh viên Trường Đại học Văn Lang đăng nhập bằng tài khoản Microsoft do trường cấp (email @vanlanguni.vn). Trang giới thiệu, Câu hỏi thường gặp và trang Chính sách & Điều khoản được xem mà không cần đăng nhập."]
          },
          {
            title: "Chấp nhận điều khoản",
            paragraphs: [
              "Khi đăng nhập và sử dụng EduPath AI, bạn đồng ý tuân theo các điều khoản này, cùng với quy chế của nhà trường và quy định của pháp luật.",
              "Cách EduPath AI thu thập và bảo vệ dữ liệu của bạn được trình bày trong Chính sách bảo mật."
            ]
          }
        ]
      },
      {
        id: "tai-khoan",
        label: "Tài khoản của bạn",
        sections: [
          {
            title: "Đăng nhập bằng tài khoản trường",
            paragraphs: ["Bạn không cần đăng ký hay tạo mật khẩu riêng. Hồ sơ EduPath AI được tạo tự động ở lần đăng nhập đầu tiên. Việc đổi hoặc khôi phục mật khẩu thực hiện qua Microsoft và bộ phận hỗ trợ tài khoản của trường."]
          },
          {
            title: "Giữ an toàn tài khoản",
            paragraphs: [
              [
                "Giữ bí mật mật khẩu và mã xác thực; không đưa cho người khác, kể cả khi nhờ tải bảng điểm giúp.",
                "Không dùng tài khoản của người khác và không cho người khác dùng tài khoản của bạn.",
                "Đăng xuất sau khi dùng máy tính chung ở phòng thực hành hay thư viện.",
                `Báo ngay qua email ${supportEmail} nếu nghi ngờ tài khoản của mình bị người khác sử dụng.`
              ],
              "Nếu bạn để người khác dùng tài khoản của mình, bạn chịu trách nhiệm về những gì họ làm bằng tài khoản đó."
            ]
          },
          {
            title: "Thông tin trong hồ sơ",
            paragraphs: [`Họ tên, mã số sinh viên, khóa và lớp được lấy từ tài khoản trường nên bạn không sửa trực tiếp được. Nếu thông tin bị sai hoặc thiếu, hãy gửi email đến ${supportEmail} để được kiểm tra.`]
          }
        ]
      },
      {
        id: "bang-diem",
        label: "Bảng điểm bạn tải lên",
        sections: [
          {
            title: "Yêu cầu đối với bảng điểm",
            paragraphs: [[
              "Là bảng điểm của chính bạn.",
              "Được xuất từ cổng đào tạo của trường và giữ nguyên nội dung.",
              "Là tệp PDF, tối đa 5 MB, không quá 20 trang và không đặt mật khẩu."
            ]]
          },
          {
            title: "Cam kết của bạn",
            paragraphs: ["Khi tích ô xác nhận trước lúc tải lên, bạn cam kết bảng điểm là của mình và chưa bị chỉnh sửa. Tải lên bảng điểm của người khác là xâm phạm dữ liệu cá nhân của họ; làm giả hoặc sửa bảng điểm có thể bị xử lý theo quy chế của nhà trường và pháp luật."]
          },
          {
            title: "Bảng điểm trên EduPath AI",
            paragraphs: [
              "Bảng điểm do bạn tự tải lên và chưa được nhà trường xác minh. Bảng điểm này chỉ dùng để bạn tự theo dõi việc học, không thay thế bảng điểm chính thức và không dùng làm minh chứng với nhà trường hay đơn vị khác.",
              "Bảng điểm và thông tin bạn cung cấp vẫn thuộc về bạn; bạn có thể thay thế hoặc xóa bất cứ lúc nào."
            ]
          }
        ]
      },
      {
        id: "quy-tac",
        label: "Quy tắc sử dụng",
        sections: [
          {
            title: "Những việc không được làm",
            paragraphs: [[
              "Tìm cách đăng nhập bằng tài khoản của người khác hoặc xem dữ liệu không thuộc về bạn.",
              "Tấn công, dò tìm lỗ hổng, làm quá tải hoặc làm gián đoạn EduPath AI.",
              "Dùng công cụ tự động để thu thập dữ liệu hàng loạt.",
              "Tải lên tệp chứa mã độc, tệp giả mạo hoặc bảng điểm đã bị chỉnh sửa.",
              "Mạo danh sinh viên, giảng viên hay nhà trường.",
              "Ghi vào hồ sơ thông tin của người khác hoặc nội dung xúc phạm, sai sự thật.",
              "Dùng kết quả trên EduPath AI như văn bản xác nhận chính thức của nhà trường."
            ]]
          },
          {
            title: "Khi phát hiện lỗi",
            paragraphs: [`Nếu phát hiện lỗi, nhất là lỗi có thể làm lộ thông tin của người khác, hãy dừng lại, không khai thác hay chia sẻ và báo ngay qua email ${supportEmail}. Mọi hoạt động kiểm thử bảo mật cần được Khoa cho phép trước bằng văn bản.`]
          }
        ]
      },
      {
        id: "ket-qua",
        label: "Giá trị của kết quả",
        sections: [
          {
            title: "Kết quả chỉ để tham khảo",
            paragraphs: [
              "Dấu đạt, chưa đạt trong chương trình và kế hoạch đào tạo, kết quả tự kiểm tra điều kiện xét tốt nghiệp, kết quả đánh giá năng lực và thông tin nghề nghiệp giúp bạn tự theo dõi và định hướng. Đây không phải kết quả chính thức của nhà trường.",
              "Kết quả có thể chưa chính xác nếu bảng điểm thiếu học kỳ, bị đọc sai, hoặc bạn chọn chưa đúng chương trình của khóa và ngành hay chuyên ngành của mình. Kết quả xét tốt nghiệp chính thức do nhà trường công bố.",
              "Kết quả đánh giá năng lực còn phụ thuộc vào trọng số học phần do Khoa cấu hình. Kỹ năng mà chương trình đào tạo chưa có học phần đo được ghi là Chưa đủ dữ liệu, không có nghĩa là bạn yếu kỹ năng đó."
            ]
          },
          {
            title: "Trước những quyết định quan trọng",
            paragraphs: ["Trước khi đăng ký học phần, thay đổi kế hoạch học tập hay nộp hồ sơ xét tốt nghiệp, hãy đối chiếu với thông báo chính thức của trường và trao đổi với giảng viên hoặc cố vấn học tập. Khi thông tin trên EduPath AI khác với văn bản chính thức, văn bản chính thức được áp dụng."]
          },
          {
            title: "Nhận xét từ AI",
            paragraphs: ["Nhận xét do AI viết trong Đánh giá năng lực chỉ mang tính tham khảo và có thể chưa chính xác. Nhận xét không thay thế quyết định của bạn, của giảng viên hay của nhà trường; hãy đối chiếu với số liệu trên trang trước khi làm theo."]
          }
        ]
      },
      {
        id: "dich-vu",
        label: "Dịch vụ và trách nhiệm",
        sections: [
          {
            title: "Cung cấp dịch vụ",
            paragraphs: [
              "Khoa cố gắng duy trì EduPath AI ổn định, nhưng dịch vụ có thể tạm gián đoạn để bảo trì, nâng cấp hoặc khắc phục sự cố. Một số chức năng có thể được bổ sung, thay đổi hoặc ngừng cung cấp.",
              "Nhận xét AI được tạo trên một máy tính riêng, nên có lúc bạn phải chờ hoặc tạm thời chưa có nhận xét; khi đó các kết quả do hệ thống tính vẫn hiển thị đầy đủ.",
              "EduPath AI không phải nơi lưu trữ tài liệu lâu dài, vì vậy hãy tự giữ bản PDF bảng điểm gốc của bạn."
            ]
          },
          {
            title: "Quyền sở hữu nội dung",
            paragraphs: ["Giao diện và nội dung do Khoa biên soạn, như chương trình đào tạo, kế hoạch đào tạo và thông tin nghề nghiệp, thuộc Khoa Công nghệ Thông tin, Trường Đại học Văn Lang. Bạn được sử dụng cho việc học tập của bản thân, nhưng không sao chép hàng loạt hay dùng vào mục đích thương mại."]
          },
          {
            title: "Giới hạn trách nhiệm",
            paragraphs: ["Khoa sẽ kiểm tra và sửa lỗi khi được thông báo. Khoa không chịu trách nhiệm về quyết định bạn đưa ra chỉ dựa trên kết quả tham khảo, kể cả nhận xét do AI viết, mà không đối chiếu nguồn chính thức, hoặc về hậu quả từ việc tải lên bảng điểm không phải của mình, bảng điểm đã bị chỉnh sửa hay để lộ tài khoản."]
          }
        ]
      },
      {
        id: "vi-pham",
        label: "Vi phạm và thay đổi",
        sections: [
          {
            title: "Xử lý vi phạm",
            paragraphs: [`Nếu vi phạm các điều khoản này, tài khoản của bạn có thể bị tạm khóa và hành vi vi phạm được xử lý theo quy chế của nhà trường và pháp luật. Nếu cho rằng tài khoản bị khóa nhầm, hãy gửi email đến ${supportEmail} để được xem xét.`]
          },
          {
            title: "Thay đổi điều khoản",
            paragraphs: ["Điều khoản có thể được cập nhật khi EduPath AI thay đổi chức năng. Nội dung mới được đăng tại trang này cùng ngày cập nhật. Với thay đổi quan trọng, như khi có tính năng mới cần dùng dữ liệu của bạn, bạn sẽ được thông báo và hỏi ý kiến ngay trên EduPath AI trước khi dùng tính năng đó."]
          },
          {
            title: "Luật áp dụng và liên hệ",
            paragraphs: [
              "Các điều khoản này được điều chỉnh theo pháp luật Việt Nam. Khi có vướng mắc, hãy trao đổi với Khoa trước; nếu không giải quyết được, bạn có quyền đề nghị cơ quan nhà nước có thẩm quyền giải quyết.",
              `Nếu có câu hỏi, hãy xem Câu hỏi thường gặp hoặc gửi email đến ${supportEmail}.`
            ]
          }
        ]
      }
    ]
  }
};
