const mongoose = require('mongoose');

const PROCESSING_STATUS = {
  UPLOADING: 'uploading',
  PROCESSING: 'processing',
  READY: 'ready',
  FAILED: 'failed',
  ARCHIVED: 'archived',
};

const knowledgeDocumentSchema = new mongoose.Schema(
  {
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    // File metadata
    originalName: { type: String, required: true },
    storageKey: { type: String, required: true }, // safe server-generated key (never trust client name)
    mimeType: { type: String, default: 'application/pdf' },
    fileSize: { type: Number, default: 0 },

    // Educational context
    gradeLevel: { type: Number, default: null },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', default: null },
    book: { type: String, default: '' },
    chapter: { type: String, default: '' },
    lesson: { type: String, default: '' },

    // Processing
    status: {
      type: String,
      enum: Object.values(PROCESSING_STATUS),
      default: PROCESSING_STATUS.UPLOADING,
    },
    pageCount: { type: Number, default: 0 },
    chunkCount: { type: Number, default: 0 },
    skippedPages: { type: Number, default: 0 },
    error: { type: String, default: null },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

knowledgeDocumentSchema.index({ owner: 1, status: 1 });
knowledgeDocumentSchema.index({ gradeLevel: 1, subject: 1 });

const KnowledgeDocument = mongoose.model('KnowledgeDocument', knowledgeDocumentSchema);
KnowledgeDocument.PROCESSING_STATUS = PROCESSING_STATUS;

module.exports = KnowledgeDocument;
