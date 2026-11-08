/**
 * 页面容器 —— 统一 3D 沉浸式风格
 * 星空背景由 App 层统一提供，这里只负责排版
 */
export default function PageShell({ title, subtitle, actions, children, bare = false }) {
  return (
    <div className="page-shell">
      <div>
        {!bare && (
          <header className="page-heading">
            <div>
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
            </div>
            {actions && <div className="page-heading-actions">{actions}</div>}
          </header>
        )}
        {children}
      </div>
    </div>
  )
}
