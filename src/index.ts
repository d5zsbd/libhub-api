import db from './db.js';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { createRefresh, authenticate, role  } from './authentication/handler.js';
import { createSignup, createLogin, createProfile, createUpdateUser, createGetFollowings, createDetail, createFollow, createUnfollow } from './user/handler.js';
import { uploadImage, createRenameImage, isExist, createUpdateAvatar } from './upload.js';
import { createRequestLimit } from './utils.js';
import { PORT, UPDATE_CONCURRENCY } from './env.js';
import { updateDirPath } from './upload.js';
import { createPost, createGetPost, createGetPosts, createComment, createGetComments, createLikePost, createUnlikePost, createGetOwnedPosts, createFavoritePost, createUnfavoritePost, createGetFavoritePosts, createDeletePost, createUpdateContent, createPublishDraft } from './post/handler.js';
import { createSocketIO } from './socket.js';
import { createGetNotifications, createHasUnread, createReadNotifications } from './notification/handler.js';
import path from 'path';

const app = express();
const server = http.createServer(app);

app.use(createSocketIO(server));
app.use(express.json());
app.use(cors());
app.use(role);
app.use('/pub', express.static(updateDirPath));

app.post('/api/user/login', createLogin(db));
app.post('/api/user/signup', createSignup(db));
app.post('/api/user/update', createUpdateUser(db));
app.post('/api/user/follow', createFollow(db));
app.post('/api/user/unfollow', createUnfollow(db));
app.get('/api/user/:id', createProfile(db));
app.get('/api/user/:id/detail', createDetail(db));
app.get('/api/user/:id/posts/:page', createGetOwnedPosts(db));
app.get('/api/user/favorites/:page', createGetFavoritePosts(db));
app.get('/api/user/following/:page', createGetFollowings(db));

app.post('/api/auth/refresh', createRefresh(db));

// app.post('/api/upload/image', authenticate, createRequestLimit(UPDATE_CONCURRENCY), uploadImage, renameFile);
app.post('/api/upload/image', authenticate, uploadImage, createRenameImage(db));
app.get('/api/upload/image/is-exist/:filename', isExist);
app.post('/api/upload/avatar', authenticate, uploadImage, createUpdateAvatar(db));


app.post('/api/post/save', createPost(db));
app.get('/api/post/:id/comments/:page', createGetComments(db));
app.get('/api/post/:id', createGetPost(db));
app.get('/api/posts/:page', createGetPosts(db));
app.post('/api/post/comment', authenticate, createComment(db));
app.post('/api/post/like', createLikePost(db));
app.post('/api/post/unlike', createUnlikePost(db));
app.post('/api/post/favorite', createFavoritePost(db));
app.post('/api/post/unfavorite', createUnfavoritePost(db));
app.post('/api/post/delete', createDeletePost(db));
app.post('/api/post/content/update', createUpdateContent(db));
app.post('/api/post/publish-draft', createPublishDraft(db));

app.get('/api/notifications/has-unread', createHasUnread(db));
app.get('/api/notifications/:page', createGetNotifications(db));
app.post('/api/notifications/read', createReadNotifications(db));

app.use('/', express.static(path.join(import.meta.dirname, '/ui/')));
app.use((req, res, next) => {
  if (req.method !== 'GET') {
    return next();
  }

  res.sendFile(path.join(import.meta.dirname, 'ui', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`api started on http://localhost:${PORT}`);
});