const mongoose = require('mongoose');

const classSchema = new mongoose.Schema(
  {
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },
    name: { type: String, required: true, trim: true },
    gradeLevel: { type: Number, required: true },
    teachers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

classSchema.index({ gradeLevel: 1 });

module.exports = mongoose.model('Class', classSchema);
