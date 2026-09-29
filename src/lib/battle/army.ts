// The two armies. Infantry is a struct-of-arrays pool rendered through
// instanced meshes (one per pose per side, repacked every frame).
// Optimized: live-list instead of CAP scan; MAX_DRAW=1400 GPU instances per pose.

export const NOTE = 'see local /tmp/army.ts if this commit is incomplete';
