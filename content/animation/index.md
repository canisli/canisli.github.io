---
title: Video Models as Motion Priors for 3D Rig Animation
layout: animation
url: /research/animation/
---

{{< animation-demo src="island-reconstruction.mp4" poster="island-reconstruction.jpg" caption="Sitting on a sloped surface: WAN 2.7 output and Unity reconstruction." >}}

## Intro

Inspired by recent work on video-model planning in robotics, we explore whether a video model can serve as a motion prior for 3D character animation. Given a frame rendered by a game engine and a goal such as “open the door,” an image-to-video model generates a sequence depicting the requested motion. An inverse dynamics model (IDM) then recovers the character’s root transform and joint rotations from each generated frame.

The pipeline has four stages:

1. Render the character in its starting pose.
2. Pass the image and a text instruction, such as “the character steps onto the crate,” to an image-to-video model.
3. Estimate the character’s root position, root orientation, and local joint rotations in each generated frame.
4. Smooth the resulting pose trajectory and replay it on the original rig.

This is powerful because the video model handles the semantic problem: deciding how the character should climb, balance, sit, or step over an obstacle. The IDM only has to recover the visible configuration on the target rig.

## Training the IDM

Our IDM is adapted from [**HMR 2.0**](https://arxiv.org/abs/2305.20091), a monocular human pose estimator for SMPL. We retain the pretrained visual backbone, fine-tune the transformer decoder, and replace the SMPL prediction head with one that outputs the parameters of our animation rig.

Each frame is processed independently. In practice, we found that simple temporal smoothing was sufficient to remove frame-to-frame jitter, without requiring an autoregressive model.

### Training data

Because the IDM predicts an absolute pose from each frame rather than a change from the previous frame, training examples do not need to come from motion sequences. Instead of collecting human animations, we can generate training data by randomly sampling valid joint rotations and rendering the resulting poses.

{{< figure class="training-pose-grid" src="training-pose-grid.png" alt="Six independently sampled character poses rendered in Blender, each with its known rig skeleton overlaid in red." caption="Randomly sampled poses and camera views rendered in Blender. Red  skeletons visualize the known poses used as supervision." >}}

Training therefore requires only a rigged character and a rendering engine such as Blender. For each example, we sample a pose and camera viewpoint, render the character, and record the corresponding joint rotations. The rendered image is used as input to the IDM, with the known pose providing supervision.

### Exploiting engine control for root position

Unlike generic monocular pose estimation, our setting gives us direct control over the rendering pipeline. We know the character’s physical scale and the camera intrinsics. We can also modify the render itself—for example, hiding scene elements that would otherwise occlude the character.

Before pose estimation, the image is cropped around the detected character and resized. We retain this transformation so predictions can be mapped back to the original image. The root head predicts the character’s projected root position and size; together with the known character scale and camera intrinsics, these let us recover its root position in camera coordinates.

## Examples

We have recovered free-form dance motions as well as scene-conditioned interactions: stepping onto a crate and sitting on a sloped outdoor surface.

{{< animation-demo src="crate-reconstruction.mp4" poster="crate-reconstruction.jpg" caption="Stepping onto a crate: WAN 2.7 output and Unity reconstruction." >}}

{{< animation-demo src="slide-reconstruction.mp4" poster="slide-reconstruction.jpg" caption="Sliding down a slide: WAN 2.7 output and Unity reconstruction." >}}

## Limitations and Future Work


* **Static scenes.** Our current pipeline assumes that the environment remains fixed; interactions with moving objects would require recovering and replaying their trajectories alongside the character.
* **Occlusion.** Pose recovery degrades when limbs are hidden by the scene, and while we experimented with rendering occluding geometry transparently for the video model, a more principled solution would use multiple generated viewpoints.
* **Camera motion.** Our current setup assumes a fixed camera with known intrinsics and extrinsics; supporting a moving camera would require estimating the camera parameters for each generated frame before recovering the character’s motion in world coordinates.
* **Hands and face.** We currently recover only body motion and leave hand articulation and facial animation to future work.


## Beyond Humanoid Characters

Our experiments use one humanoid skeleton, and the current IDM inherits a human-specific prior from HMR 2.0. In principle, each distinct skeleton would require its own IDM, while visually different characters sharing a skeleton could use the same model by generating and reconstructing motion through a common canonical appearance.

The broader method is not inherently restricted to humans. With a more general visual backbone and synthetic renders of the target rig, we expect the same approach to apply to articulated characters such as dragons, animals, and fictional creatures. These are precisely the cases in which conventional motion-capture data is hardest to obtain, but static poses can still be generated cheaply inside a rendering engine.
