import { Component, type ReactNode } from "react";
import { TEXT } from "./texts";

/** 地図の部品（別 chunk）が読み込めなかったとき、画面全体を落とさず、読めなかったと伝える */
export class MapChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <p className="map-error" role="alert">
          {TEXT.mapLoadFailed}
        </p>
      );
    }
    return this.props.children;
  }
}
