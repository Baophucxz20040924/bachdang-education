const mongoose = require('mongoose');

const membershipSchema = new mongoose.Schema(
  {
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Prevent duplicate enrollment of the same student in the same class.
membershipSchema.index({ class: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('Membership', membershipSchema);
