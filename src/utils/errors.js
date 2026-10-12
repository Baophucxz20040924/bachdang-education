class AppError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

// Common Vietnamese error messages
const messages = {
  UNAUTHORIZED: 'Bạn cần đăng nhập để tiếp tục.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  NOT_FOUND: 'Không tìm thấy dữ liệu.',
  INVALID_CREDENTIALS: 'Tên đăng nhập hoặc mật khẩu không đúng.',
  ACCOUNT_DISABLED: 'Tài khoản đã bị vô hiệu hóa.',
  DUPLICATE_USER: 'Tên đăng nhập hoặc email đã tồn tại.',
  DUPLICATE_MEMBERSHIP: 'Học sinh đã có trong lớp này.',
  VALIDATION: 'Dữ liệu không hợp lệ.',
  SESSION_EMPTY: 'Buổi học cần ít nhất một câu hỏi hợp lệ để xuất bản.',
  SESSION_NO_CLASS: 'Cần chọn ít nhất một lớp để xuất bản buổi học.',
  AI_FAILED: 'Không thể tạo bài tập bằng AI lúc này. Vui lòng thử lại hoặc tạo thủ công.',
  RATE_LIMIT: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',
  MAX_ATTEMPTS: 'Bạn đã hết số lần làm bài cho phép.',
  ALREADY_SUBMITTED: 'Bài làm đã được nộp.',
};

function fail(statusCode, code, message) {
  throw new AppError(statusCode, code, message || messages[code] || 'Đã xảy ra lỗi.');
}

module.exports = { AppError, messages, fail };
