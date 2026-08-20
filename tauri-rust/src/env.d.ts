/// <reference types="vite/client" />
/// <reference types="@dinoreic/fez" />

// .fez imports are side-effect only: the vite plugin turns each into a
// Fez.compile call that registers the component.
declare module '*.fez'
