"use client";

import { useState } from "react";
import AvatarHero from "./AvatarHero";
import ModelHub from "./ModelHub";
import UltronVoice from "./UltronVoice";

const LAYERS = [
  { index: "01", title: "Brain", subtitle: "Model-agnostic reasoning", body: "Cloud providers and on-device models share one routing surface. The active model and its limits stay visible." },
  { index: "02", title: "Memory", subtitle: "Continuity across work", body: "A structured memory graph connects people, projects, decisions and artifacts without flattening everything into chat history." },
  { index: "03", title: "Tools", subtitle: "Approved execution", body: "Connectors, file operations and automation run through scoped permissions with a clear approval boundary." },
  { index: "04", title: "Workspace", subtitle: "From intent to output", body: "Tasks, artifacts, checks and recovery state turn a conversation into work that can be inspected and resumed." },
];

export default function UltronConsole() {
  const [speaking, setSpeaking] = useState(false);

  return (
    <main className="ultron-shell" id="top">
      <aside className="ultron-rail" aria-label="ULTRON console navigation">
        <a className="ultron-wordmark" href="#top">ULTRON<span>●</span></a>
        <p className="ultron-tagline">PERSONAL AI SYSTEM</p>
        <nav className="ultron-nav" aria-label="Console sections">
          <a href="#overview" aria-current="page"><span className="ultron-nav-index">01</span>Overview</a>
          <a href="#brain"><span className="ultron-nav-index">02</span>Model hub</a>
          <a href="#voice"><span className="ultron-nav-index">03</span>Voice & presence</a>
          <a href="#architecture"><span className="ultron-nav-index">04</span>System layers</a>
        </nav>
        <div className="ultron-rail-bottom">
          <span className="ultron-preview-mark"><i /> Preview environment</span>
          <p>Cloud actions require the authenticated ULTRON owner session.</p>
          <a href="https://ultron-web-6et.pages.dev/" target="_blank" rel="noreferrer">Open shared ULTRON app ↗</a>
        </div>
      </aside>

      <div className="ultron-main">
        <header className="ultron-topbar">
          <div><span className="ultron-topbar-kicker">CONTROL SURFACE</span><span className="ultron-topbar-divider">/</span><span>Overview</span></div>
          <div className="ultron-topbar-meta"><span>LOCAL-FIRST</span><span>OWNER-CONTROLLED</span></div>
        </header>

        <section id="overview" className="ultron-overview" aria-labelledby="ultron-title">
          <div className="ultron-overview-copy">
            <span className="ultron-eyebrow">PERSONAL AI OPERATING SYSTEM</span>
            <h1 id="ultron-title" className="ultron-h1">ULTRON<span>.</span></h1>
            <p className="ultron-overview-lead">One assistant. A connected brain. Tools that act only with the right permission.</p>
            <p className="ultron-overview-body">A local-first workspace for reasoning, memory, model orchestration and real work across your devices. Built to stay useful when the network, provider or model changes.</p>
            <div className="ultron-overview-tags"><span>MODEL AGNOSTIC</span><span>PRIVATE BY DESIGN</span><span>APPROVAL FIRST</span></div>
            <div className="ultron-overview-actions">
              <a className="ultron-btn" href="#brain">Explore model hub <span aria-hidden="true">↘</span></a>
              <a className="ultron-text-link" href="#architecture">How ULTRON is built</a>
            </div>
          </div>
          <div className="ultron-overview-core"><AvatarHero speaking={speaking} /></div>
        </section>

        <section id="brain" className="ultron-section" aria-labelledby="brain-title">
          <div className="ultron-section-heading">
            <div><span className="ultron-eyebrow">01 / INTELLIGENCE</span><h2 id="brain-title">Model hub</h2></div>
            <p>Browse open models, inspect provider connections and manage the owner’s API credentials.</p>
          </div>
          <ModelHub />
        </section>

        <section id="voice" className="ultron-section" aria-labelledby="voice-title">
          <div className="ultron-section-heading">
            <div><span className="ultron-eyebrow">02 / PRESENCE</span><h2 id="voice-title">Voice console</h2></div>
            <p>Preview speech and drive the core’s speaking state. Browser speech is used when available.</p>
          </div>
          <UltronVoice onSpeakingChange={setSpeaking} />
        </section>

        <section id="architecture" className="ultron-section" aria-labelledby="architecture-title">
          <div className="ultron-section-heading">
            <div><span className="ultron-eyebrow">03 / ARCHITECTURE</span><h2 id="architecture-title">Four connected layers</h2></div>
            <p>Each layer has a clear responsibility. Together they turn a prompt into inspectable, permission-aware work.</p>
          </div>
          <div className="ultron-architecture-grid">
            {LAYERS.map((layer) => (
              <article className="ultron-layer-card" key={layer.index}>
                <span className="ultron-layer-index">{layer.index}</span>
                <h3>{layer.title}</h3>
                <span className="ultron-layer-subtitle">{layer.subtitle}</span>
                <p>{layer.body}</p>
              </article>
            ))}
          </div>
        </section>

        <footer className="ultron-footer">
          <span>ULTRON / LUO&apos;S CREATIONS</span>
          <span>Personal infrastructure. Owner controlled.</span>
        </footer>
      </div>
    </main>
  );
}
