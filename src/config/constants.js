const ROLES = { ADMIN: 'admin', TEACHER: 'teacher', STUDENT: 'student' };

const QUESTION_TYPES = {
  MULTIPLE_CHOICE: 'multiple_choice',
  TRUE_FALSE: 'true_false',
  FILL_BLANK: 'fill_blank',
  MISSING_WORD: 'missing_word',
  SHORT_ANSWER: 'short_answer',
  MATCHING: 'matching',
};

const QUESTION_TYPE_LIST = Object.values(QUESTION_TYPES);

const SESSION_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
};

const ATTEMPT_STATUS = {
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'submitted',
  NEEDS_GRADING: 'needs_grading',
  GRADED: 'graded',
};

const REVEAL_POLICY = {
  AFTER_SUBMIT: 'after_submit',
  AFTER_DUE: 'after_due',
  MANUAL: 'manual',
};

const GRADE_LEVELS = [1, 2, 3, 4, 5];

// Vietnamese labels for statuses (used by analytics / UI mapping if needed server-side)
const VI_ATTEMPT_STATUS = {
  not_started: 'Chưa bắt đầu',
  in_progress: 'Đang làm',
  submitted: 'Đã nộp bài',
  needs_grading: 'Chờ chấm',
  graded: 'Đã chấm',
};

const VI_QUESTION_TYPE = {
  multiple_choice: 'Trắc nghiệm',
  true_false: 'Đúng hoặc sai',
  fill_blank: 'Điền vào chỗ trống',
  missing_word: 'Điền từ còn thiếu',
  short_answer: 'Trả lời ngắn',
  matching: 'Nối',
};

module.exports = {
  ROLES,
  QUESTION_TYPES,
  QUESTION_TYPE_LIST,
  SESSION_STATUS,
  ATTEMPT_STATUS,
  REVEAL_POLICY,
  GRADE_LEVELS,
  VI_ATTEMPT_STATUS,
  VI_QUESTION_TYPE,
};
