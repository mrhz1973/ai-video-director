# Reference asset manifest

These assets are stored outside Git. A filename alone is not sufficient identity; verify the SHA-256 before reuse.

| Key | External filename | SHA-256 | Role | Status |
|---|---|---|---|---|
| TATTOO_EXACT | 04_TATTOO_EXACT_TWO_ANGLES.png | 91e18b0ea82522b9306df68a1a3d58e7e2199e583954fef1fcd3f49d91a26396 | Exclusive tattoo artwork, color, fade, scale, rotation and placement | Approved source |
| BODY_PROPORTIONS_MASTER | 03_BODY_PROPORTIONS_MASTER.png | edfcd09f6b7ce6807370c959985cb532bd2d25ab4083f9e8a262c00a21a79b26 | Original front, rear and lateral body comparison | Approved comparison only |
| BODY_SIDE_HEADLESS_EXACT_V2 | 05_BODY_SIDE_HEADLESS_EXACT_V2.png | ec28bcba8638e57574cde1891476bb3acce1eefd4e850f2409ccfc9cf8be8ff0 | Exact deterministic lateral crop, including source hair/tattoo state | Intermediate, not active |
| BODY_SIDE_HEADLESS_HAIRLESS_V3 | 06_BODY_SIDE_HEADLESS_HAIRLESS_V3.png | 6951a8eb68266f49ff4a548315b034b2333aca46854d3506177cde9545a1ed6e | Active lateral neck-down anatomy, shoulder scale and hairless skin reference | Approved for V4 Element |
| BODY_HEADLESS_REJECTED | exec-49436a06-86e6-4762-a64a-911f4167f9f7.png | 205a86e164e0734c04e4e495e33962c6cff6ee51825fd10ab893a52b5675b787 | Earlier generated two-view body plate | Rejected: residual hair, tattoo drift, weak scale bridge |
| FACE_BASELINE_VIDEO | hf_20260816_162204_212a1577-f004-48d3-8e87-8a0ef13ecf96.mp4 | e2f21f65fcef94f754b8f275abc06dfbf3344fcfac250eafd41f0d87e81aa9ea | Earlier strong facial likeness | Approved face comparison |
| V2A_VIDEO | 1a(1).mp4 | 605d6e2c38e8fd1e0a54003a7dbd1210ca3668b4f6c781bc654eb47fd7aa113a | Preferred body anatomy and skin comparison | Approved baseline |
| V2B_VIDEO | 1b(1).mp4 | 10c08ed4dc3d6719eeb118baed2c571f1031defb963693db5790854ad095cb30 | Alternate V2 result | Not selected |
| V3_VIDEO | 1c(1).mp4 | 2a77fff4e6e0eb50120db0f99088b41739460fe679ae395827f44170c2a88a01 | Face, framing, hut and eye-led turn comparison | Partial approval only |

## Active V4 reference hierarchy

1. Face portraits inside the active Character Element.
2. BODY_SIDE_HEADLESS_HAIRLESS_V3 for neck-down anatomy and scale.
3. TATTOO_EXACT for tattoo appearance and placement.
4. V2A and BODY_PROPORTIONS_MASTER for comparison only.
5. V3 for face, framing and performance comparison only.

