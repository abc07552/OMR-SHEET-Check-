export type Matrix3 = number[][];
export const identity3 = (): Matrix3 => [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
export function multiply3(a: Matrix3, b: Matrix3): Matrix3 {
  return a.map((row) =>
    b[0].map((_, c) => row.reduce((sum, value, k) => sum + value * b[k][c], 0)),
  );
}
export function inverse3(m: Matrix3): Matrix3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const determinant =
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
    throw new Error("The sheet transform is singular. Retake a clearer photo.");
  return [
    [e * i - f * h, c * h - b * i, b * f - c * e],
    [f * g - d * i, a * i - c * g, c * d - a * f],
    [d * h - e * g, b * g - a * h, a * e - b * d],
  ].map((row) => row.map((v) => v / determinant));
}
export function project3(m: Matrix3, x: number, y: number) {
  const z = m[2][0] * x + m[2][1] * y + m[2][2];
  if (Math.abs(z) < 1e-12) throw new Error("Invalid sheet coordinate.");
  return {
    x: (m[0][0] * x + m[0][1] * y + m[0][2]) / z,
    y: (m[1][0] * x + m[1][1] * y + m[1][2]) / z,
  };
}
export function rotation3(k: number, width: number, height: number): Matrix3 {
  return [
    identity3(),
    [
      [0, 1, 0],
      [-1, 0, width - 1],
      [0, 0, 1],
    ],
    [
      [-1, 0, width - 1],
      [0, -1, height - 1],
      [0, 0, 1],
    ],
    [
      [0, -1, height - 1],
      [1, 0, 0],
      [0, 0, 1],
    ],
  ][k % 4];
}
