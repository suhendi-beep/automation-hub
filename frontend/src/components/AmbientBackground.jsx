import React from "react";

export default function AmbientBackground() {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient-ribbon r1" />
      <div className="ambient-ribbon r2" />
      <div className="ambient-ribbon r3" />
      <div className="ambient-streak s1" />
      <div className="ambient-streak s2" />
      <div className="ambient-streak s3" />
      <div className="ambient-spot" />
      <div className="ambient-vignette" />
      <div className="ambient-noise" />
    </div>
  );
}
