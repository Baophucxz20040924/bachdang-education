const mongoose = require('mongoose');
const {
  QUESTION_TYPE_LIST,
  SESSION_STATUS,
  REVEAL_POLICY,
} = require('../config/constants');

// Flexible embedded question. Type-specific validation is enforced by Zod at the
// service layer (question.schema.js). We keep the Mongoose schema permissive but typed.
const questionSchema = new mongoose.Schema(
  {
    qid: { type: String, required: true },
    type: { type: String, enum: QUESTION_TYPE_LIST, required: true },
    prompt: { type: String, required: true },
    instruction: { type: String, default: null },
    points: { type: Number, default: 1 },
    explanation: { type: String, default: null },
    difficulty: { type: String, default: null },
    source: { type: String, enum: ['ai', 'manual'], default: 'manual' },
    sources: { type: mongoose.Schema.Types.Mixed, default: undefined },
    media: { type: mongoose.Schema.Types.Mixed, default: null },
    // Auto-grade matching options for text answers
    autoGrade: { type: Boolean },
    caseSensitive: { type: Boolean },
    ignoreAccents: { type: Boolean },

    // multiple_choice
    options: { type: [String] },
    correctIndex: { type: Number },
    // true_false
    correctValue: { type: Boolean },
    // fill_blank / missing_word / short_answer
    answer: { type: String },
    expectedAnswer: { type: String },
    acceptable: { type: [String] },
    wordBank: { type: [String] },
    text: { type: String },
    // matching
    left: { type: [String] },
    right: { type: [String] },
    pairs: { type: [[Number]] },
  },
  { _id: false },
);

const sessionSchema = new mongoose.Schema(
  {
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    gradeLevel: { type: Number, required: true },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    topic: { type: String, default: '' },
    objectives: { type: [String], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: Object.values(SESSION_STATUS),
      default: SESSION_STATUS.DRAFT,
    },
    targetClasses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
    questions: { type: [questionSchema], default: [] },
    settings: {
      openAt: { type: Date, default: null },
      dueAt: { type: Date, default: null },
      timeLimitMinutes: { type: Number, default: null },
      maxAttempts: { type: Number, default: 1 },
      revealPolicy: {
        type: String,
        enum: Object.values(REVEAL_POLICY),
        default: REVEAL_POLICY.AFTER_SUBMIT,
      },
    },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

sessionSchema.index({ createdBy: 1, status: 1 });
sessionSchema.index({ status: 1, targetClasses: 1 });

module.exports = mongoose.model('Session', sessionSchema);
