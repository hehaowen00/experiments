import { Show, For, createMemo } from 'solid-js';
import Icon from '../lib/Icon';
import { useWorkspace } from '../context/WorkspaceContext';

function ActivityGraph(props) {
  const max = createMemo(() => Math.max(1, ...props.weeks));

  return (
    <div class="contrib-graph">
      <For each={props.weeks}>{(count) => {
        const height = () => Math.max(2, (count / max()) * 32);
        const opacity = () => count === 0 ? 0.1 : 0.3 + (count / max()) * 0.7;
        return (
          <div
            class="contrib-bar"
            style={{
              height: `${height()}px`,
              opacity: opacity(),
              background: props.color || 'var(--accent)',
            }}
            title={`${count} commit${count !== 1 ? 's' : ''}`}
          />
        );
      }}</For>
    </div>
  );
}

function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

export default function ContributorsPanel() {
  const ws = useWorkspace();
  const totalCommits = createMemo(() =>
    ws.contributors.list.reduce((sum, c) => sum + c.commits, 0)
  );

  return (
    <div class="contrib-panel">
      <Show when={ws.contributors.loading}>
        <div class="git-empty">Loading contributors...</div>
      </Show>
      <Show when={!ws.contributors.loading && ws.contributors.list.length === 0}>
        <div class="git-empty">No contributors found</div>
      </Show>
      <Show when={ws.contributors.list.length > 0}>
        <div class="contrib-overview">
          <div class="contrib-stat">
            <span class="contrib-stat-value">{ws.contributors.list.length}</span>
            <span class="contrib-stat-label">contributors</span>
          </div>
          <div class="contrib-stat">
            <span class="contrib-stat-value">{formatNum(totalCommits())}</span>
            <span class="contrib-stat-label">total commits</span>
          </div>
        </div>

        <Show when={ws.contributors.repoActivity.length > 0}>
          <div class="contrib-section">
            <div class="contrib-section-title">Commit activity (last 52 weeks)</div>
            <ActivityGraph weeks={ws.contributors.repoActivity} color="var(--accent)" />
            <div class="contrib-graph-labels">
              <span>1 year ago</span>
              <span>Now</span>
            </div>
          </div>
        </Show>

        <div class="contrib-section">
          <div class="contrib-section-title">Contributors</div>
          <div class="contrib-cards">
            <For each={ws.contributors.list}>{(c) => {
              const pct = () => ((c.commits / totalCommits()) * 100).toFixed(1);
              const selected = () => ws.contributors.selectedEmail === c.email;
              return (
                <div class={`contrib-card ${selected() ? 'selected' : ''}`} onClick={() => ws.selectContributor(c.email)}>
                  <div class="contrib-card-top">
                    <div class="contrib-card-identity">
                      <span class="contrib-card-name">{c.name}</span>
                      <span class="contrib-card-email">{c.email}</span>
                    </div>
                    <div class="contrib-card-bar-track">
                      <div class="contrib-card-bar-fill" style={{ width: `${pct()}%` }} />
                    </div>
                  </div>
                  <div class="contrib-card-stats">
                    <span class="contrib-card-stat">
                      <Icon name="fa-solid fa-code-commit" />
                      <strong>{formatNum(c.commits)}</strong> commits
                    </span>
                    <span class="contrib-card-stat contrib-card-stat-add">
                      <strong>+{formatNum(c.additions)}</strong>
                    </span>
                    <span class="contrib-card-stat contrib-card-stat-del">
                      <strong>-{formatNum(c.deletions)}</strong>
                    </span>
                    <span class="contrib-card-stat">
                      <Icon name="fa-solid fa-file" />
                      <strong>{formatNum(c.files)}</strong> files
                    </span>
                  </div>
                  <Show when={selected()}>
                    <Show when={ws.contributors.activityLoading}>
                      <div class="contrib-card-activity-loading">Loading activity...</div>
                    </Show>
                    <Show when={!ws.contributors.activityLoading && ws.contributors.selectedActivity.length > 0}>
                      <div class="contrib-card-activity">
                        <ActivityGraph weeks={ws.contributors.selectedActivity} color="var(--success)" />
                        <div class="contrib-graph-labels">
                          <span>1 year ago</span>
                          <span>Now</span>
                        </div>
                      </div>
                    </Show>
                  </Show>
                </div>
              );
            }}</For>
          </div>
        </div>
      </Show>
    </div>
  );
}
