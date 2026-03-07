import { createSignal, For, Show } from 'solid-js';
import Icon from '../components/Icon';
import {
  detectUnit,
  toMs,
  formatDate,
  formatAs,
  FORMAT_LIST,
  relativeTime,
} from '../datetime';

export default function DateTimeTool(props) {
  const [input, setInput] = createSignal('');
  const [results, setResults] = createSignal(null);
  const [error, setError] = createSignal('');

  const [nowTime, setNowTime] = createSignal(Date.now());

  setInterval(() => setNowTime(Date.now()), 1000);

  function convert() {
    const raw = input().trim();
    if (!raw) {
      setResults(null);
      setError('');
      return;
    }

    // Try to extract sub-second precision for nano support
    let nanos = null;
    const nanoMatch = raw.match(
      /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d+)/,
    );
    if (nanoMatch) {
      nanos = nanoMatch[2].padEnd(9, '0').slice(0, 9);
    }

    // Try parsing as a number (unix timestamp)
    const num = Number(raw);
    let date;
    let detectedUnit_ = null;
    if (!isNaN(num) && raw.match(/^\d+$/)) {
      detectedUnit_ = detectUnit(num);
      date = new Date(toMs(num, detectedUnit_));
      if (!nanos && detectedUnit_ === 'nanoseconds') {
        const nsVal = BigInt(raw);
        const fracNs = nsVal % 1000000000n;
        nanos = String(fracNs).padStart(9, '0');
      }
    } else {
      date = new Date(raw);
    }

    if (!date || isNaN(date.getTime())) {
      setError('Could not parse input');
      setResults(null);
      return;
    }

    const ms = date.getTime();
    setError('');
    setResults({
      detectedUnit: detectedUnit_,
      seconds: Math.floor(ms / 1000),
      milliseconds: Math.floor(ms),
      nanoseconds: Math.floor(ms * 1e6),
      relative: relativeTime(date),
      formats: FORMAT_LIST.map((f) => ({
        ...f,
        value: formatAs(date, f.id, nanos),
      })),
    });
  }

  function useNow() {
    setInput(String(Date.now()));
    convert();
  }

  return (
    <div class="landing-main" style={props.style}>
      <div class="landing-toolbar">
        <button class="btn btn-ghost btn-sm" onClick={props.onToggleSidebar}>
          <Icon name="fa-solid fa-bars" />
        </button>
      </div>
      <div class="dt-tool">
        <div class="dt-section">
          <div class="dt-section-header">Current Time</div>
          <div class="dt-now-grid">
            <ResultRow
              label="UTC"
              value={formatDate(new Date(nowTime()), 'utc')}
            />
            <ResultRow
              label="Local"
              value={formatDate(new Date(nowTime()), 'local')}
            />
            <ResultRow
              label="Unix (s)"
              value={String(Math.floor(nowTime() / 1000))}
            />
            <ResultRow label="Unix (ms)" value={String(nowTime())} />
            <ResultRow label="Unix (ns)" value={String(nowTime() * 1e6)} />
          </div>
        </div>

        <div class="dt-section">
          <div class="dt-section-header">Convert</div>
          <div class="dt-input-row">
            <input
              type="text"
              class="dt-input"
              placeholder="Unix timestamp, date string, or any ISO/RFC format"
              value={input()}
              onInput={(e) => {
                setInput(e.target.value);
                convert();
              }}
            />
            <button class="btn btn-ghost btn-sm" onClick={useNow}>
              Now
            </button>
          </div>
          {error() && <div class="dt-error">{error()}</div>}
          {results() && (
            <>
              <div class="dt-results">
                {results().detectedUnit && (
                  <ResultRow
                    label="Detected"
                    value={results().detectedUnit}
                  />
                )}
                <ResultRow
                  label="Unix (s)"
                  value={String(results().seconds)}
                />
                <ResultRow
                  label="Unix (ms)"
                  value={String(results().milliseconds)}
                />
                <ResultRow
                  label="Unix (ns)"
                  value={String(results().nanoseconds)}
                />
                <ResultRow label="Relative" value={results().relative} />
              </div>
              <div class="dt-results">
                <For each={results().formats}>
                  {(f) => <ResultRow label={f.label} value={f.value} />}
                </For>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultRow(props) {
  const [copied, setCopied] = createSignal(false);

  function copy() {
    navigator.clipboard.writeText(props.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div class="dt-result-row">
      <span class="dt-result-label">{props.label}</span>
      <span class="dt-result-value">{props.value}</span>
      <button class="btn btn-ghost btn-sm dt-copy-btn" onClick={copy}>
        {copied() ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
