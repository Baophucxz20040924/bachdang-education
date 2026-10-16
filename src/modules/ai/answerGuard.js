// ===========================================================================
// Answer-leak guard for the student tutor.
//
// LLM prompts alone don't reliably stop a confident model from blurting out
// the answer to a trivial sum ("4 + 2 = 6"). This module is a deterministic
// safety net applied to the model's OUTPUT: if the student asked for an answer
// AND the reply reveals a computed/arithmetic result, we replace the reply with
// a safe, guiding message so no direct answer ever reaches the student.
// ===========================================================================

// The student is "answer-seeking" if they ask for the result or write a bare
// arithmetic expression to be solved.
function isAnswerSeeking(message) {
  const q = String(message || '').toLowerCase();
  if (/(đáp án|đáp số|kết quả|bao nhiêu|bằng mấy|bằng bao nhiêu|tính giúp|tính hộ|giải giúp|giải hộ|làm giúp|làm hộ)/.test(q)) {
    return true;
  }
  // A math expression like "4+2", "7 x 5", "12 - 3", "8 : 2" (optionally "= ?").
  if (/\d\s*[+\-x×*/:÷]\s*\d/.test(q)) return true;
  return false;
}

// Does the reply actually STATE a result? We look for an arithmetic equality
// that ends in a number ("4 + 2 = 6"), or phrasing that asserts a numeric
// result ("là 6", "bằng 6", "kết quả là 6", "được 6", "= 6").
function revealsResult(reply) {
  const s = String(reply || '');
  // "a op b = c"  (full equation with a numeric right-hand side)
  if (/\d\s*[+\-x×*/:÷]\s*\d[\s\S]{0,6}=\s*\d/.test(s)) return true;
  // "= 6" following nothing in particular but with a number
  if (/=\s*\d+(?:[.,]\d+)?/.test(s)) return true;
  // "bằng 6", "là 6", "được 6", "kết quả (là) 6", "đáp án (là) 6" (number word)
  if (/(bằng|là|được|kết quả\s*(?:là)?|đáp án\s*(?:là)?|tổng\s*(?:là|bằng)?)\s*\d+(?:[.,]\d+)?\b/i.test(s)) return true;
  return false;
}

// Build the safe replacement when a leak is detected. Keeps the warm teacher
// voice and nudges the student to compute it themselves.
function safeGuidedReply() {
  return 'Cô sẽ không nói ra kết quả đâu, vì tự tìm được thì em sẽ nhớ lâu hơn nhiều! 😊\n\n'
    + '**Cách làm:** em đọc kỹ đề, xem đề cho gì và hỏi gì, rồi làm từng bước nhỏ. '
    + 'Với phép cộng, em có thể bắt đầu từ số thứ nhất rồi **đếm thêm** từng đơn vị của số thứ hai.\n\n'
    + 'Em thử tính rồi nói kết quả cho cô nghe nhé — cô sẽ xem em làm đúng chưa nào! 🌟';
}

// Apply the guard. Returns a safe reply string.
function guardReply(message, reply) {
  if (isAnswerSeeking(message) && revealsResult(reply)) {
    return safeGuidedReply();
  }
  return reply;
}

module.exports = { guardReply, isAnswerSeeking, revealsResult, safeGuidedReply };
