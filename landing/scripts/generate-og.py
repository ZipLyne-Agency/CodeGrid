import asyncio
import os
from playwright.async_api import async_playwright

HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; border-radius: 0 !important; }

  body {
    width: 1200px;
    height: 630px;
    background: #0a0a0a;
    font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
    overflow: hidden;
    position: relative;
  }

  .dot-grid {
    position: absolute;
    inset: 0;
    background-image: radial-gradient(circle, #1e1e1e 1px, transparent 1px);
    background-size: 24px 24px;
  }

  .glow-orange {
    position: absolute;
    top: -100px;
    left: -60px;
    width: 480px;
    height: 420px;
    background: radial-gradient(ellipse at center, rgba(255,140,0,0.15) 0%, transparent 70%);
  }

  .container {
    position: relative;
    z-index: 1;
    width: 660px;
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 54px 64px;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .logo-grid {
    width: 28px;
    height: 28px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3px;
  }

  .logo-grid .c { background: #ff8c00; }
  .logo-grid .d { background: #2a2a2a; }

  .logo-name {
    font-size: 17px;
    font-weight: 700;
    color: #e0e0e0;
    letter-spacing: -0.01em;
  }

  .spacer { flex: 1; }

  .eyebrow {
    font-size: 11px;
    font-weight: 600;
    color: #ff8c00;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 22px;
  }

  .eyebrow-line {
    width: 24px;
    height: 1px;
    background: #ff8c00;
    display: inline-block;
  }

  .headline {
    font-size: 68px;
    font-weight: 800;
    line-height: 1.0;
    color: #e0e0e0;
    letter-spacing: -0.03em;
    margin-bottom: 24px;
  }

  .headline .acc { color: #ff8c00; }

  .sub {
    font-size: 18px;
    color: #888888;
    font-weight: 400;
    line-height: 1.5;
    letter-spacing: -0.01em;
    max-width: 480px;
  }

  .bottom {
    border-top: 1px solid #2a2a2a;
    padding-top: 22px;
    margin-top: 40px;
    display: flex;
    align-items: center;
    gap: 24px;
  }

  .agent {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .dot {
    width: 7px;
    height: 7px;
  }

  .agent-label {
    font-size: 12px;
    font-weight: 600;
    color: #e0e0e0;
    letter-spacing: 0.04em;
  }

  .flex1 { flex: 1; }

  .cta {
    font-size: 12px;
    color: #0a0a0a;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 7px 14px;
    background: #ff8c00;
    display: flex;
    align-items: center;
    gap: 7px;
    white-space: nowrap;
  }

  /* Terminal panel - right side */
  .panel {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 520px;
    border-left: 1px solid #2a2a2a;
    background: #0d0d0d;
    display: flex;
    flex-direction: column;
  }

  .panel-header {
    background: #141414;
    border-bottom: 1px solid #2a2a2a;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .ph-dots {
    display: flex;
    gap: 5px;
  }

  .ph-dot {
    width: 9px;
    height: 9px;
    background: #2a2a2a;
  }

  .ph-title {
    font-size: 11px;
    color: #555;
    margin-left: 4px;
    letter-spacing: 0.04em;
    font-weight: 500;
  }

  .tabs {
    display: flex;
    border-bottom: 1px solid #2a2a2a;
  }

  .tab {
    font-size: 11px;
    padding: 8px 16px;
    color: #555;
    border-right: 1px solid #2a2a2a;
    font-weight: 500;
    letter-spacing: 0.03em;
  }

  .tab.active {
    color: #e0e0e0;
    background: #1a1a1a;
    border-bottom: 1px solid #ff8c00;
    margin-bottom: -1px;
  }

  .tab-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 5px;
    vertical-align: middle;
  }

  .agents-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: #2a2a2a;
    flex: 1;
  }

  .agent-pane {
    background: #0d0d0d;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .ap-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .ap-indicator {
    width: 7px;
    height: 7px;
  }

  .ap-name {
    font-size: 11px;
    font-weight: 700;
    color: #e0e0e0;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .ap-status {
    font-size: 10px;
    color: #555;
    margin-left: auto;
    letter-spacing: 0.04em;
  }

  .ap-line {
    font-size: 11px;
    color: #888;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.6;
  }

  .ap-line .cmd { color: #e0e0e0; }
  .ap-line .ok { color: #00c853; }
  .ap-line .info { color: #4a9eff; }
  .ap-line .warn { color: #ffab00; }

  .cursor-block {
    display: inline-block;
    width: 6px;
    height: 12px;
    background: currentColor;
    vertical-align: text-bottom;
    margin-left: 1px;
  }
</style>
</head>
<body>
  <div class="dot-grid"></div>
  <div class="glow-orange"></div>

  <div class="container">
    <div class="logo">
      <div class="logo-grid">
        <div class="c"></div>
        <div class="d"></div>
        <div class="d"></div>
        <div class="c"></div>
      </div>
      <span class="logo-name">CodeGrid</span>
    </div>

    <div class="spacer"></div>

    <div>
      <div class="eyebrow">
        <span class="eyebrow-line"></span>
        AI-native terminal workspace
      </div>
      <div class="headline">Claude, Codex,<br>Gemini. <span class="acc">One<br>canvas.</span></div>
      <div class="sub">Run multiple AI coding agents in parallel on a 2D canvas. Built for macOS.</div>
    </div>

    <div class="bottom">
      <div class="agent"><div class="dot" style="background:#ff8c00"></div><span class="agent-label">Claude</span></div>
      <div class="agent"><div class="dot" style="background:#10a37f"></div><span class="agent-label">Codex</span></div>
      <div class="agent"><div class="dot" style="background:#4285f4"></div><span class="agent-label">Gemini</span></div>
      <div class="agent"><div class="dot" style="background:#a855f7"></div><span class="agent-label">Cursor</span></div>
      <div class="agent"><div class="dot" style="background:#4a9eff"></div><span class="agent-label">Shell</span></div>
      <div class="flex1"></div>
      <div class="cta">Download Free <span>&#8594;</span></div>
    </div>
  </div>

  <!-- Right panel: agent grid -->
  <div class="panel">
    <div class="panel-header">
      <div class="ph-dots">
        <div class="ph-dot"></div>
        <div class="ph-dot"></div>
        <div class="ph-dot"></div>
      </div>
      <span class="ph-title">codegrid — workspace</span>
    </div>
    <div class="tabs">
      <div class="tab active"><span class="tab-dot" style="background:#00c853;display:inline-block"></span>Agents</div>
      <div class="tab">Canvas</div>
      <div class="tab">Git</div>
    </div>
    <div class="agents-grid">
      <!-- Claude -->
      <div class="agent-pane">
        <div class="ap-header">
          <div class="ap-indicator" style="background:#ff8c00"></div>
          <span class="ap-name">Claude</span>
          <span class="ap-status" style="color:#00c853">● running</span>
        </div>
        <div class="ap-line"><span class="cmd">$ refactor auth module</span></div>
        <div class="ap-line"><span class="ok">✓</span> Updated middleware.ts</div>
        <div class="ap-line"><span class="ok">✓</span> Updated session.ts</div>
        <div class="ap-line">→ Fixing type errors<span class="cursor-block" style="color:#ff8c00"></span></div>
      </div>

      <!-- Codex -->
      <div class="agent-pane">
        <div class="ap-header">
          <div class="ap-indicator" style="background:#10a37f"></div>
          <span class="ap-name">Codex</span>
          <span class="ap-status" style="color:#00c853">● running</span>
        </div>
        <div class="ap-line"><span class="cmd">$ write unit tests</span></div>
        <div class="ap-line"><span class="info">●</span> Running vitest...</div>
        <div class="ap-line"><span class="ok">✓</span> 24 tests passed</div>
        <div class="ap-line"><span class="warn">!</span> 2 snapshots updated</div>
      </div>

      <!-- Gemini -->
      <div class="agent-pane">
        <div class="ap-header">
          <div class="ap-indicator" style="background:#4285f4"></div>
          <span class="ap-name">Gemini</span>
          <span class="ap-status" style="color:#ffab00">● waiting</span>
        </div>
        <div class="ap-line"><span class="cmd">$ optimize bundle</span></div>
        <div class="ap-line">→ Analyzing imports...</div>
        <div class="ap-line">→ Tree-shaking lodash</div>
        <div class="ap-line" style="color:#555">  idle — awaiting task</div>
      </div>

      <!-- Shell -->
      <div class="agent-pane">
        <div class="ap-header">
          <div class="ap-indicator" style="background:#4a9eff"></div>
          <span class="ap-name">Shell</span>
          <span class="ap-status" style="color:#4a9eff">● idle</span>
        </div>
        <div class="ap-line"><span class="cmd">$ git push origin main</span></div>
        <div class="ap-line"><span class="ok">✓</span> Pushed 4 commits</div>
        <div class="ap-line" style="color:#555">  <span class="ok">✓</span> CI passing</div>
        <div class="ap-line"><span class="cmd">$ <span class="cursor-block" style="color:#4a9eff"></span></span></div>
      </div>
    </div>
  </div>
</body>
</html>"""

async def main():
    out = os.path.join(os.path.dirname(__file__), "../public/og.png")
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.set_viewport_size({"width": 1200, "height": 630})
        await page.set_content(HTML, wait_until="networkidle")
        await page.wait_for_timeout(2500)  # font load
        await page.screenshot(path=out, type="png", clip={"x": 0, "y": 0, "width": 1200, "height": 630})
        await browser.close()
        print(f"OG image saved to {out}")

asyncio.run(main())
