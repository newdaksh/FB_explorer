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

const COMMENTS_PAGE_LIMIT = 5;
const ATTACHMENTS_PER_PAGE = 4; // numeric pagination size for attachments

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
        attachmentsPage: 1,
        attachmentsPagesCount: 0,
        showAttachments: false,
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

      const pagesCount = Math.max(
        1,
        Math.ceil(flat.length / ATTACHMENTS_PER_PAGE)
      );

      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                attachments: flat,
                attachmentsLoading: false,
                attachmentsError: null,
                attachmentsPage: 1,
                attachmentsPagesCount: pagesCount,
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

  function showAttachmentsToggle(postId) {
    // toggle visibility; fetch attachments if opening and not fetched
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        const willShow = !p.showAttachments;
        if (willShow && p.attachments === null) {
          // fetch attachments then set showAttachments true
          loadAttachments(postId);
          return { ...p, showAttachments: true };
        }
        return { ...p, showAttachments: willShow };
      })
    );
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
        return { ...p, showComments: willShow };
      })
    );
  }

  function setAttachmentsPage(postId, pageNum) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId ? { ...p, attachmentsPage: pageNum } : p
      )
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
          // first page: no 'after' cursor
          fetchUrl = `https://graph.facebook.com/v23.0/${postId}/comments?fields=from,message,created_time&limit=${COMMENTS_PAGE_LIMIT}&access_token=${ACCESS_TOKEN}`;
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

  // Utility: render numeric pagination UI for pages (1..N). For comments we render based on known pages length but allow +2 extra numbers to fetch ahead.
  function renderPageButtons(
    current,
    totalKnownPages,
    onClickNumber,
    allowExtra = 2,
    maxButtons = 20
  ) {
    // We'll show pages 1 .. max( totalKnownPages + allowExtra, current+allowExtra ) but cap to maxButtons
    const totalToShow = Math.min(
      maxButtons,
      Math.max(totalKnownPages + allowExtra, current + allowExtra)
    );
    const nums = Array.from({ length: totalToShow }, (_, i) => i + 1);
    return (
      <div className="page-buttons">
        {nums.map((n) => (
          <button
            key={n}
            className={`btn ${n === current ? "active" : ""}`}
            onClick={() => onClickNumber(n)}
            disabled={n === current}
            aria-current={n === current ? "page" : undefined}
            title={n === current ? `Page ${n} (current)` : `Go to page ${n}`}
            type="button"
          >
            {n}
          </button>
        ))}
      </div>
    );
  }

  // component mount: optionally auto-load posts? We'll let user click button.
  // useEffect(() => { fetchPosts(); }, []);

  // ---------- Render helpers ----------
  function renderAttachmentsSection(post) {
    // if null -> not fetched yet (show button to fetch)
    if (post.attachments === null) {
      return (
        <div className="mt8">
          <button
            className="btn"
            onClick={() => loadAttachments(post.id)}
            disabled={post.attachmentsLoading}
          >
            {post.attachmentsLoading
              ? "Loading attachments..."
              : "Load attachments"}
          </button>
          {post.attachmentsError && (
            <div className="error mt8">Error: {post.attachmentsError}</div>
          )}
        </div>
      );
    }
    // attachments fetched (maybe empty)
    const flat = post.attachments || [];
    if (flat.length === 0)
      return (
        <div className="mt8">
          <em>No attachments</em>
        </div>
      );

    const totalPages = Math.max(
      1,
      Math.ceil(flat.length / ATTACHMENTS_PER_PAGE)
    );
    const page = Math.min(Math.max(1, post.attachmentsPage || 1), totalPages);
    const start = (page - 1) * ATTACHMENTS_PER_PAGE;
    const slice = flat.slice(start, start + ATTACHMENTS_PER_PAGE);

    return (
      <div className="mt8">
        <div className="attachment-row">
          {slice.map((a, idx) => (
            <div key={a.id || idx} className="attachment-card">
              {a.title && <div className="attachment-title">{a.title}</div>}
              {a.description && (
                <div className="attachment-desc">{a.description}</div>
              )}
              {a.url ? (
                a.url.match(/\.(jpeg|jpg|gif|png|webp)$/i) ? (
                  <img src={a.url} alt="att" className="attachment-img" />
                ) : (
                  <div className="attachment-link">
                    <a href={a.url} target="_blank" rel="noreferrer">
                      {a.url}
                    </a>
                  </div>
                )
              ) : (
                <div className="italic mt8">No preview</div>
              )}
            </div>
          ))}
        </div>

        {/* Numeric pagination */}
        <div className="mt10">
          {renderPageButtons(
            post.attachmentsPage,
            totalPages,
            (n) => setAttachmentsPage(post.id, n),
            0 /* don't allow extra pages for attachments -- client-side known */
          )}
        </div>
      </div>
    );
  }

  function renderCommentsSection(post) {
    const pages = post.commentsPages || [];
    const current = post.commentsCurrentPage || 1;
    // if no pages fetched yet -> show a button to load page 1
    if (!pages.length) {
      return (
        <div className="mt8">
          <button
            className="btn"
            onClick={() => loadCommentsPage(post.id, 1)}
            disabled={post.commentsLoading}
          >
            {post.commentsLoading
              ? "Loading comments..."
              : `Load comments (5 per page)`}
          </button>
          {post.commentsError && (
            <div className="error mt8">Error: {post.commentsError}</div>
          )}
        </div>
      );
    }

    const pageObj = pages[current - 1] || { data: [] };
    const comments = pageObj.data || [];

    return (
      <div className="mt8">
        {post.commentsLoading && <div>Loading...</div>}
        {post.commentsError && (
          <div className="error">Error: {post.commentsError}</div>
        )}

        {!post.commentsLoading && comments.length === 0 && (
          <div>
            <em>No comments on this page</em>
          </div>
        )}

        {comments.map((c) => (
          <div key={c.id} className="comment-item">
            <div className="comment-from">{c.fromName}</div>
            <div className="comment-time">
              {new Date(c.created_time).toLocaleString()}
            </div>
            <div className="comment-text">{c.message}</div>
          </div>
        ))}

        {/* Numeric comment pages. We allow extra buttons so the user can click to fetch next pages.
            totalKnownPages = pages.length. We'll allow +2 extra numbers to fetch ahead */}
        <div className="mt10">
          {renderPageButtons(
            current,
            pages.length,
            (n) => loadCommentsPage(post.id, n),
            2,
            25
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="container app-container">
      <h1>FB Explorer — POSTS with comments & attachments</h1>

      <div className="controls-row">
        <button className="btn" onClick={fetchPosts} disabled={loadingPosts}>
          {loadingPosts ? "Loading..." : "Get posts"}
        </button>
        <button
          className="btn"
          onClick={() => {
            setPosts([]);
            setErrorPosts(null);
          }}
        >
          Clear
        </button>
        <div className="note-small">
          Attachments and comments are on demand 💯.
        </div>
      </div>

      {errorPosts && <div className="error-mb12">Error: {errorPosts}</div>}

      {posts.length === 0 && !loadingPosts && (
        <div>No posts yet. Click Get posts.</div>
      )}

      {posts.map((post) => (
        <div key={post.id} className="post-card">
          <div className="post-meta">
            <div className="post-date">
              {new Date(post.created_time).toLocaleString()}
            </div>
            <div className="post-comments-count">
              Comments: {post.commentCount}
            </div>
          </div>
          <div className="post-message">
            {post.message || <em>(no message)</em>}
          </div>

          <div className="post-actions">
            {/* Attachment show/hide toggle */}
            <button
              className="btn"
              onClick={() => showAttachmentsToggle(post.id)}
              disabled={post.attachmentsLoading}
            >
              {post.attachmentsLoading
                ? "Loading attachments..."
                : post.showAttachments
                ? "Hide attachments"
                : "Show attachments"}
            </button>

            {/* Comments show/hide toggle */}
            <button
              className="btn"
              onClick={() => toggleComments(post.id)}
              disabled={post.commentsLoading}
            >
              {post.commentsLoading
                ? "Loading comments..."
                : post.showComments
                ? "Hide comments"
                : "Show comments"}
            </button>
          </div>

          {/* Attachments panel: visible only when showAttachments is true */}
          {post.showAttachments && (
            <div className="mt6">
              <strong>Attachments:</strong>
              {renderAttachmentsSection(post)}
            </div>
          )}
          {/* Comments panel: visible only when showComments is true */}
          {post.showComments && (
            <div className="mt10">
              <strong>Comments:</strong>
              {renderCommentsSection(post)}
            </div>
          )}
        </div>
      ))}

      {/* <div className="notes-block">
        Notes:
        <ul>
          <li>
            Comments are fetched from Graph with{" "}
            <code>limit={COMMENTS_PAGE_LIMIT}</code> and paged using cursors;
            pages are cached as you fetch them.
          </li>
          <li>
            Attachments are fetched on demand and paginated client-side (
            {ATTACHMENTS_PER_PAGE} per page).
          </li>
          <li>
            In production, move the token & Graph calls to a backend proxy to
            avoid CORS and for token security.
          </li>
        </ul>
      </div> */}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
