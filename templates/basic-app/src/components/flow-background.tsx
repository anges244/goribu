// Native SVG motion keeps the decoration independent of JavaScript/hydration.
// Remove this component and its HomePage usage for an undecorated starting point.
export default function FlowBackground() {
  return (
    <svg
      viewBox="0 0 1600 1000"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none fixed -inset-x-[10vw] -inset-y-[12vh] h-[124vh] w-[120vw]"
    >
      <g fill="none" strokeWidth="1.15" className="stroke-flow">
        <path
          id="flow-a"
          vectorEffect="non-scaling-stroke"
          d="M -80 730 C 260 620, 330 250, 690 300 S 1110 710, 1700 390"
        />
        <path
          vectorEffect="non-scaling-stroke"
          className="opacity-55"
          d="M -120 315 C 210 430, 500 150, 810 210 S 1240 560, 1690 180"
        />
        <path
          id="flow-c"
          vectorEffect="non-scaling-stroke"
          d="M 80 1070 C 290 760, 590 815, 770 610 S 980 210, 1540 -40"
        />
        <path
          vectorEffect="non-scaling-stroke"
          className="opacity-55"
          d="M 255 -70 C 420 180, 350 500, 620 660 S 1190 720, 1640 1020"
        />
      </g>

      <g className="fill-flow-strong opacity-50">
        <circle cx="690" cy="300" r="3.5" />
        <circle cx="770" cy="610" r="3" />
        <circle cx="1240" cy="560" r="2.5" />
      </g>

      <g className="fill-accent motion-reduce:hidden">
        <circle r="4">
          <animateMotion dur="16s" repeatCount="indefinite" begin="-3s">
            <mpath href="#flow-a" />
          </animateMotion>
        </circle>
        <circle r="3">
          <animateMotion dur="22s" repeatCount="indefinite" begin="-11s">
            <mpath href="#flow-c" />
          </animateMotion>
        </circle>
      </g>
    </svg>
  );
}
