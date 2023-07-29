/* Copyright (c) 2023 Christopher Tralie
* Re-implementations of some of the above operations
* as GLSL shaders
*/

// Color to grayscale conversion
CV.GrayscaleAndFlipShader = {
    uniforms: {
        'tDiffuse': {value: null}
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
  
    fragmentShader: /* glsl */`
        #include <common>
        uniform sampler2D tDiffuse;
        varying vec2 vUv;

        void main() {
            vec2 uv = vUv;
            // Flip upside down because aruco is upside down with
            // respect to the gl canvas
            uv.y = 1.0-uv.y; 
            vec4 texel = texture2D( tDiffuse, uv );
            float l = 0.299*texel.r + 0.587*texel.g + 0.114*texel.b;
            gl_FragColor = vec4( l, l, l, texel.w );
        }`
  };

/**
 * 
 * @param {int} horiz If 0, do vertical pass.  If 1, do horizontal pass
 * @param {float} dpix The amount, in texture coords, by which to jump to adjacent pixels
 * @returns 
 */
CV.getGaussFilt1d = function(horiz, dpix) {
    return {
        uniforms: {
            'tDiffuse': {value: null},
            'horiz': {value: horiz},
            'dpix': {value: dpix}
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
            }`,

        fragmentShader: /* glsl */`
            #include <common>
            uniform sampler2D tDiffuse;
            uniform int horiz;
            uniform float dpix;
            varying vec2 vUv;

            const float kernel[7] = float[7](0.004, 0.054, 0.242, 0.4, 0.242, 0.054, 0.004);

            void main() {
                vec4 sum = vec4(0.0, 0.0, 0.0, 0.0);
                int idx = 0;
                for (float di = -3.0; di <= 3.0; di+=1.0) {
                    vec2 uv = vUv;
                    if (horiz == 0) {
                        uv.y += di*dpix;
                    }
                    else {
                        uv.x += di*dpix;
                    }
                    sum += kernel[idx]*texture2D(tDiffuse, uv);
                    idx++;
                }
                gl_FragColor = sum;
            }`
    };
}

CV.getThresholdFilter = function(thresh) {
    return {
        uniforms: {
            'tDiffuse': {value: null},
            'thresh': {value: thresh}
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
            }`,

        fragmentShader: /* glsl */`
            #include <common>
            uniform sampler2D tDiffuse;
            uniform float thresh;
            varying vec2 vUv;

            void main() {
                vec4 texel = texture2D( tDiffuse, vUv );
                float l = 0.0;
                if (texel.x < thresh) {
                    l = 1.0;
                }
                gl_FragColor = vec4( l, l, l, texel.w );
            }`
    };
}