const mongoose = require('mongoose');
const { ATTEMPT_STATUS } = require('../config/constants');

const attemptSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    status: {
      type: String,
      enum: Object.values(ATTEMPT_STATUS),
      default: ATTEMPT_STATUS.IN_PROGRESS,
    },
    // Snapshot of questions (including answer keys) taken at start time so later
    // edits to the session never corrupt an in-progress or submitted attempt.
    questionSnapshot: { type: [mongoose.Schema.Types.Mixed], default: [] },
    answers: {
      type: [
        {
          qid: String,
          response: mongoose.Schema.Types.Mixed,
          _id: false,
        },
      ],
      default: [],
    },
    autoScore: { type: Number, default: 0 },
    manualScore: { type: Number, default: null },
    totalScore: { type: Number, default: null },
    maxScore: { type: Number, default: 0 },
    attemptNumber: { type: Number, default: 1 },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },
    gradedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

attemptSchema.index({ session: 1, student: 1 });
attemptSchema.index({ student: 1, status: 1 });

module.exports = mongoose.model('Attempt', attemptSchema);
