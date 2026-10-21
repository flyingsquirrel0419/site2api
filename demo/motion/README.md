# README demo — motion graphic

The 18-second explainer at the top of the README (`docs/assets/demo.mp4` / `demo.gif`), built with
[HyperFrames](https://github.com/heygen-com/hyperframes) (`product-launch-video` workflow, no
narration). `BRIEF.md` is the confirmed brief, `STORYBOARD.md` the frame-by-frame plan, and
`compositions/frames/` the five scenes.

```bash
cd demo/motion
npx hyperframes@0.8.183 preview                                  # edit in Studio
npx hyperframes@0.8.183 render --quality high --output renders/video.mp4
ffmpeg -i renders/video.mp4 -vf "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" ../../docs/assets/demo.gif
```

Fonts: Barlow and IBM Plex Mono (SIL Open Font License), from Fontsource.
