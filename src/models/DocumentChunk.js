const mongoose = require('mongoose');

const documentChunkSchema = new mongoose.Schema(
  {
    document: { type: mongoose.Schema.Types.ObjectId, ref: 'KnowledgeDocument', required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },

    chunkIndex: { type: Number, required: true },
    text: { type: String, required: true },
    pageStart: { type: Number, default: null },
    pageEnd: { type: Number, default: null },
    // Chapter/lesson tags detected from headings (e.g. "Chương 1", "Bài 2").
    chapterLabel: { type: String, default: null },
    chapterNumber: { type: Number, default: null },
    lessonLabel: { type: String, default: null },
    lessonNumber: { type: Number, default: null },

    gradeLevel: { type: Number, default: null },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', default: null },

    // Embedding vector stored inline for cosine similarity in the service layer.
    embedding: { type: [Number], default: [] },
    // Hash of the chunk text to prevent duplicate chunks on retry.
    contentHash: { type: String, required: true },
  },
  { timestamps: true },
);

// Prevent duplicate chunks for the same document on reprocessing.
documentChunkSchema.index({ document: 1, contentHash: 1 }, { unique: true });
documentChunkSchema.index({ owner: 1 });
documentChunkSchema.index({ document: 1, chapterNumber: 1, lessonNumber: 1 });

module.exports = mongoose.model('DocumentChunk', documentChunkSchema);
