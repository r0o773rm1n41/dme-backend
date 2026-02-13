// Script to clean up invalid 'likes' arrays in Blog documents
// Usage: node fixBlogLikes.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || process.env.DB_URI || process.env.MONGO_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not set in .env');
  process.exit(1);
}

// Blog model definition (minimal, just for this script)
const blogSchema = new mongoose.Schema({
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { strict: false });

const Blog = mongoose.model('Blog', blogSchema, 'blogs');

async function fixLikes() {
  await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('✅ Connected to MongoDB');

  const blogs = await Blog.find({ likes: { $exists: true, $not: { $size: 0 } } });
  let fixed = 0;

  for (const blog of blogs) {
    // Print all blogs' _id and likes fields
    console.log(`Blog ${blog._id} likes:`, blog.likes);
    if (!Array.isArray(blog.likes)) continue;
    let needsFix = false;
    for (const like of blog.likes) {
      // If like is not a valid ObjectId (including stringified arrays like "[ 1 ]"), mark for fix
      if (!mongoose.Types.ObjectId.isValid(like)) {
        needsFix = true;
        break;
      }
    }
    if (needsFix) {
      blog.likes = [];
      await blog.save();
      fixed++;
      console.log(`Fixed blog ${blog._id} (invalid likes removed)`);
    }
  }
  console.log(`🎉 Done. Fixed ${fixed} blog(s).`);
  await mongoose.disconnect();
}

fixLikes().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
