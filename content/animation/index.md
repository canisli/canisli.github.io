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

Because the IDM predicts absolute pose rather than the change between consecutive frames, its training examples do not need to come from coherent motion sequences. Training requires only a rigged character and a rendering engine such as Blender.

For each example, we pose the skeleton, sample a camera viewpoint around the character, render an image, and save the corresponding joint rotations and camera parameters. The rendered image is the input to the IDM, while the known rig and camera parameters provide direct supervision.

Training poses need not come from an existing animation library. Our experiments suggest that randomly sampling the rig’s configuration space is a practical alternative, avoiding the need for a curated motion dataset. Designing a sampling distribution that provides broad coverage while remaining concentrated on plausible configurations is an interesting problem that we do not investigate here.

### Exploiting engine control for root position

Unlike generic monocular pose estimation, our setting gives us direct control over the rendering pipeline. We know the character’s physical scale, the camera intrinsics, and the exact crop transform. We can also modify the render itself—for example, hiding scene elements that would otherwise occlude the character.

For example, we use this privileged information to recover the character’s root position. The root head predicts the projected root 2D position and the projected character size in crop space.  Combined with the known character scale, camera intrinsics, and crop transform, these are sufficient to invert the perspective projection and  recover the root position in camera coordinates.

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
