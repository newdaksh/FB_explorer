const { useState, useEffect } = React;

/**
 * Replace ACCESS_TOKEN with a valid one or, better, move to a server proxy.
 * CORS: calling Graph from browser may hit CORS or permission issues — use a server proxy in production.
 */

const ACCESS_TOKEN =
  "EAAQBdOPIdZA4BPtcr4UJpZCwKC8rTqZAjUhcGyTdAAcxHZBqJhs6e2JcCQJFvJJEf1ZBZAGRnOERnTTHGoNnEysyoMn37lEZCeRHIzswqxbUjjD9ZAQvocd5EC9d8tEMJvAVVCMlHZC0IMiFWoMtqEX25A99c6rhgXENc0tSji8sHjmK5SKsDJ37C6ayHmaZA2zfFYAcUgghYZD";

const POSTS_ENDPOINT =
  `https://graph.facebook.com/v23.0/107765138775274/posts` +
  `?fields=message,created_time,comments.summary(true).limit(0)` + // give summary count only (no comment data)
  `&access_token=${ACCESS_TOKEN}`;

const COMMENTS_INITIAL_LIMIT = 2; // initial fetch when 'Show Comments' clicked
const COMMENTS_PAGE_LIMIT = 5; // subsequent 'Load More' fetches

function App() {
  const [posts, setPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [errorPosts, setErrorPosts] = useState(null);

  // Fetch posts (no comment data, no attachments)
  async function fetchPosts() {
    setLoadingPosts(true);
    setErrorPosts(null);
    try {
      const res = await fetch(POSTS_ENDPOINT);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      const items = (data.data || []).map((p) => ({
        id: p.id,
        message: p.message || "",
        created_time: p.created_time,
        commentCount:
          (p.comments &&
            p.comments.summary &&
            p.comments.summary.total_count) ||
          0,
        // attachments lazy state
        attachments: null, // null means not fetched; [] means fetched and empty
        attachmentsLoading: false,
        attachmentsError: null,
        // comments lazy state
        commentsPages: [], // array of {data:[], cursors:{before,after}}
        commentsLoading: false,
        commentsError: null,
        commentsCurrentPage: 1,
        showComments: false,
      }));
      setPosts(items);
    } catch (err) {
      console.error(err);
      setErrorPosts(err.message || "Fetch error");
    } finally {
      setLoadingPosts(false);
    }
  }

  // ------------- ATTACHMENTS -------------
  // Lazy-load attachments for a post (fetch attachments edge/field)
  async function loadAttachments(postId) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? { ...p, attachmentsLoading: true, attachmentsError: null }
          : p
      )
    );
    try {
      const url = `https://graph.facebook.com/v23.0/${postId}?fields=attachments{media,media_type,subattachments,description,title,url}&access_token=${ACCESS_TOKEN}`;
      const res = await fetch(url);
      if (!res.ok) {
        let text = `${res.status} ${res.statusText}`;
        try {
          const j = await res.json();
          if (j && j.error && j.error.message) text = j.error.message;
        } catch {}
        throw new Error(text);
      }
      const json = await res.json();
      const attachmentsRaw = (json.attachments && json.attachments.data) || [];

      // Flatten attachments & subattachments into an array of items we can paginate client-side
      const flat = [];
      attachmentsRaw.forEach((a) => {
        // if subattachments, push each
        if (
          a.subattachments &&
          a.subattachments.data &&
          a.subattachments.data.length
        ) {
          a.subattachments.data.forEach((sa) => {
            const mediaUrl =
              (sa.media &&
                (sa.media.image ? sa.media.image.src : sa.media.src)) ||
              sa.url ||
              null;
            flat.push({
              id:
                sa.target && sa.target.id
                  ? sa.target.id
                  : `${a.id || postId}-${flat.length}`,
              url: mediaUrl,
              type: sa.type || sa.media_type || a.type || a.media_type || null,
              title: sa.title || a.title || null,
              description: sa.description || a.description || null,
            });
          });
        } else {
          const mediaUrl =
            (a.media && (a.media.image ? a.media.image.src : a.media.src)) ||
            a.url ||
            null;
          flat.push({
            id:
              a.target && a.target.id
                ? a.target.id
                : a.id || `${postId}-${flat.length}`,
            url: mediaUrl,
            type: a.type || a.media_type || null,
            title: a.title || null,
            description: a.description || null,
          });
        }
      });

      // No need for pagination calculations anymore
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                attachments: flat,
                attachmentsLoading: false,
                attachmentsError: null,
              }
            : p
        )
      );
    } catch (err) {
      console.error("Attachments error:", err);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                attachmentsLoading: false,
                attachmentsError: err.message || "Failed to load attachments",
              }
            : p
        )
      );
    }
  }

  // Toggle comments visibility and fetch first page if needed
  function toggleComments(postId) {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        const willShow = !p.showComments;
        if (willShow && (!p.commentsPages || p.commentsPages.length === 0)) {
          // fetch first page
          loadCommentsPage(postId, 1);
        }
        // If hiding comments, reset state
        if (!willShow) {
          return { ...p, showComments: willShow };
        }
        return { ...p, showComments: willShow };
      })
    );
  }

  // ------------- COMMENTS (numeric pagination with server cursors) -------------
  // Fetch a page by index (1-based). We maintain commentsPages array where pages[0] is page 1.
  async function loadCommentsPage(postId, targetPage = 1) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? { ...p, commentsLoading: true, commentsError: null }
          : p
      )
    );
    try {
      // We'll fetch pages sequentially until we have the target page cached or no more pages.
      const post = posts.find((p) => p.id === postId);
      const pages = post && post.commentsPages ? [...post.commentsPages] : [];

      // If target page already exists, just set current page and stop
      if (pages[targetPage - 1]) {
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  commentsCurrentPage: targetPage,
                  commentsLoading: false,
                }
              : p
          )
        );
        return;
      }

      // Otherwise fetch in a loop until we reach the desired page or until no next cursor
      let lastPage = pages.length ? pages[pages.length - 1] : null;
      let continueFetch = true;
      while (continueFetch && pages.length < targetPage) {
        let fetchUrl;
        if (!lastPage) {
          // first page: no 'after' cursor - fetch only 2 comments initially
          fetchUrl = `https://graph.facebook.com/v23.0/${postId}/comments?fields=from,message,created_time&limit=${COMMENTS_INITIAL_LIMIT}&access_token=${ACCESS_TOKEN}`;
        } else if (lastPage.cursors && lastPage.cursors.after) {
          // use 'after' cursor
          const after = lastPage.cursors.after;
          fetchUrl = `https://graph.facebook.com/v23.0/${postId}/comments?fields=from,message,created_time&limit=${COMMENTS_PAGE_LIMIT}&after=${encodeURIComponent(
            after
          )}&access_token=${ACCESS_TOKEN}`;
        } else {
          // no next cursor -> cannot reach target page
          break;
        }

        const res = await fetch(fetchUrl);
        if (!res.ok) {
          let text = `${res.status} ${res.statusText}`;
          try {
            const j = await res.json();
            if (j && j.error && j.error.message) text = j.error.message;
          } catch {}
          throw new Error(text);
        }
        const json = await res.json();

        const commentsData = (json.data || []).map((c) => ({
          id: c.id,
          fromName: (c.from && c.from.name) || "Unknown",
          message: c.message || "",
          created_time: c.created_time,
        }));

        const cursors =
          json.paging && json.paging.cursors
            ? {
                before: json.paging.cursors.before,
                after: json.paging.cursors.after,
              }
            : { before: null, after: null };

        pages.push({ data: commentsData, cursors });
        lastPage = pages[pages.length - 1];

        // stop if no more 'after' cursor
        if (!lastPage.cursors.after) continueFetch = false;
      }

      // update post with fetched pages
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                commentsPages: pages,
                commentsCurrentPage: Math.min(targetPage, pages.length),
                commentsLoading: false,
              }
            : p
        )
      );
    } catch (err) {
      console.error("Comments fetch error:", err);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                commentsLoading: false,
                commentsError: err.message || "Failed to load comments",
              }
            : p
        )
      );
    }
  }

  // ---------- Render helpers ----------
  function renderAttachmentsSection(post) {
    // Show all attachments automatically in a beautiful grid
    const flat = post.attachments || [];
    if (flat.length === 0) return null;

    return (
      <div className="mt8">
        <div className="attachments-grid">
          {flat.map((a, idx) => (
            <div key={a.id || idx} className="attachment-card">
              {a.title && <div className="attachment-title">{a.title}</div>}
              {a.description && (
                <div className="attachment-desc">{a.description}</div>
              )}
              {a.url ? (
                <img
                  src={a.url}
                  alt={a.title || "attachment"}
                  className="attachment-img"
                  onError={(e) => {
                    // Replace broken images with a small inline placeholder
                    e.target.onerror = null;
                    e.target.style.display = "none";
                    const ph = document.createElement("div");
                    ph.className = "italic mt8";
                    ph.textContent = "📄 No preview available";
                    e.target.parentNode && e.target.parentNode.appendChild(ph);
                  }}
                />
              ) : (
                <div className="italic mt8">📄 No preview available</div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderCommentsSection(post) {
    const pages = post.commentsPages || [];
    const current = post.commentsCurrentPage || 1;

    // Collect all comments from all loaded pages
    const allComments = [];
    for (let i = 0; i < current && i < pages.length; i++) {
      if (pages[i] && pages[i].data) {
        allComments.push(...pages[i].data);
      }
    }

    // Check if there are more comments to load
    const canLoadMore =
      pages.length === 0 ||
      (pages.length > 0 && pages[pages.length - 1].cursors.after);

    return (
      <div className="comments-section">
        {post.commentsError && (
          <div className="error mb16">Error: {post.commentsError}</div>
        )}

        {allComments.length === 0 && !post.commentsLoading && !canLoadMore && (
          <div className="text-center">
            <em>💬 No comments yet</em>
          </div>
        )}

        {
          // Show all loaded comments
        }
        {allComments.map((c) => (
          <div key={c.id} className="comment-item">
            <div className="comment-from">👤 {c.fromName}</div>
            <div className="comment-time">
              🕒 {new Date(c.created_time).toLocaleString()}
            </div>
            <div className="comment-text">{c.message}</div>
          </div>
        ))}

        {/** Only show the control when there are at least 3 comments **/}
        {(post.commentCount || 0) >= 3 && (
          <button
            className="load-more-btn"
            onClick={() => {
              // Always fetch the next page of comments if available
              if (canLoadMore) {
                loadCommentsPage(post.id, current + 1);
              }
            }}
            disabled={post.commentsLoading || !canLoadMore}
          >
            {post.commentsLoading ? (
              <>
                <span className="spinner spinner-with-margin"></span>
                Loading More Comments...
              </>
            ) : (
              `💬 Show more comments`
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="container">
      {/* Modern glassmorphism header */}
      <div className="app-header">
        <h1>FB Explorer ⚡</h1>

        {/* <p className="app-header-subtitle">
          Premium Social Media Dashboard with Modern UI
        </p> */}

        <h4>Click "Get Posts" to start exploring amazing content</h4>
      </div>

      <div className="controls-row">
        <button
          className="btn alt"
          onClick={fetchPosts}
          disabled={loadingPosts}
        >
          {loadingPosts ? (
            <>
              <span className="spinner spinner-with-margin"></span>
              Loading Posts...
            </>
          ) : (
            "🚀 Get Posts"
          )}
        </button>
        <button
          className="btn secondary"
          onClick={() => {
            setPosts([]);
            setErrorPosts(null);
          }}
        >
          🗑️ Clear
        </button>
        {/* <div className="note-small">
          ✨ Attachments and comments load automatically
        </div> */}
      </div>

      {errorPosts && (
        <div className="error error-mb12">❌ Error: {errorPosts}</div>
      )}

      {loadingPosts && (
        <div>
          {/* Loading skeletons */}
          {[1, 2, 3].map((i) => (
            <div key={i} className="post-card">
              <div className="skeleton skeleton-title"></div>
              <div className="skeleton skeleton-text"></div>
              <div className="skeleton skeleton-text"></div>
              <div className="skeleton skeleton-text skeleton-text-short"></div>
            </div>
          ))}
        </div>
      )}

      {/* {posts.length === 0 && !loadingPosts && (
        <div className="post-card text-center">
          <h3>🌟 Welcome to FB Explorer!</h3>
          <p>Click "Get Posts" to start exploring amazing content</p>
        </div>
      )} */}

      {posts.map((post) => (
        <div key={post.id} className="post-card">
          <div className="post-meta">
            <div className="post-date">
              📅 {new Date(post.created_time).toLocaleString()}
            </div>
            <div className="post-comments-count">
              💬 {post.commentCount} Comments
            </div>
          </div>
          <div className="post-message">
            {post.message || <em>📝 (no message)</em>}
          </div>

          {/* Auto-load attachments on first render */}
          {post.attachments === null &&
            !post.attachmentsLoading &&
            (() => {
              // Auto-load attachments without user interaction
              setTimeout(() => loadAttachments(post.id), 100);
              return null;
            })()}

          {/* Show attachments loading state */}
          {post.attachmentsLoading && (
            <div className="mt8 text-center">
              <span className="spinner spinner-with-margin"></span>
              Loading attachments...
            </div>
          )}

          {/* Show attachment error */}
          {post.attachmentsError && (
            <div className="error mt8">
              ❌ Error loading attachments: {post.attachmentsError}
            </div>
          )}

          {/* Render attachments automatically */}
          {post.attachments && post.attachments.length > 0 && (
            <div className="mt6">
              <strong>🖼️ Attachments ({post.attachments.length}):</strong>
              {renderAttachmentsSection(post)}
            </div>
          )}

          <div className="post-actions">
            {/* Comments show/hide toggle */}
            <button
              className="btn"
              onClick={() => toggleComments(post.id)}
              disabled={post.commentsLoading}
            >
              {post.commentsLoading ? (
                <>
                  <span className="spinner spinner-with-margin"></span>
                  Loading comments...
                </>
              ) : post.showComments ? (
                "🙈 Hide Comments"
              ) : (
                "👀 Show Comments"
              )}
            </button>
          </div>

          {/* Comments panel: visible only when showComments is true */}
          {post.showComments && (
            <div className="mt10">
              <strong>💬 Comments:</strong>
              {renderCommentsSection(post)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
