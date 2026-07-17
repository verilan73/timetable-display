# Possible Future Enhancements

## Generalise for any aSc Timetables export

Currently the app assumes a 5-day cycle, a single or A/B week rotation, and exactly two schools. Since aSc Timetables always produces the same XML structure regardless of school, three targeted changes would make this work for any deployment without code modification:

### 1. Dynamic day detection (small, self-contained)
`DAY_FROM_BITS` in `Code.js` is a hardcoded 5-bit lookup table. Replace it with logic that reads the bit-length from the XML data and generates day labels (D1–D*n*) dynamically. A school with a 6- or 8-day cycle would then work automatically.

### 2. Generalised week rotation (small, self-contained)
`detectSchema()` already reads the `weeksdefs` block to detect A/B rotation. Extend it to read however many week definitions are present (1, 2, 3, 4…) and label them accordingly. Week rotation would become fully data-driven rather than a binary single/AB switch.

### 3. Configurable number of schools (architectural)
The two-school structure (MSSS + JS) is baked into the architecture: two hardcoded XML filenames, two parallel `getTimetableData()` calls at startup, and a fixed left/right split in the teacher timeline. Making this general would require:
- A `SCHOOL_COUNT` Script Property and an array of filename properties
- The backend building a dynamic list of schools rather than two named ones
- The frontend constructing school tabs and teacher split columns from that list

This touches more of the codebase than the other two but would make the app deployable at any school with any number of divisions — purely through Script Properties, no code changes required.

---

## Google Sites embedding
The app can be embedded directly in a Google Sites page via **Insert → Embed → URL**. No additional development needed — just paste the deployment URL. Noted here as it may not be obvious to future administrators.
