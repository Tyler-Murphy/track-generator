import Bezier from 'bezier-js'
import test from 'parallel-test'
import {
    hasGapsInOutline,
    helpers,
    hasShortOutline,
} from '../index'
import * as assert from 'assert'

test(`The error case can be reproduced by creating a curve without its outline end cap at the end of the curve`, () => {
    const curve = new Bezier([
        {"x":26.764741441252585,"y":14.508115036396083},
        {"x":26.749606110997018,"y":15.750461599445467},
        {"x":26.760053965636178,"y":14.611960334110986},
        {"x":27.997466690510706,"y":15.674049942248468}
    ])
    const outline = curve.outline(0.1435862622276224 / 2)

    assert.equal(outline.curves.length, 10)
    assert.ok(!hasGapsInOutline(outline.curves))
    assert.ok(outline.length() < 0.95 * 2 * curve.length())
    assert.ok(hasShortOutline(curve, outline))
})

test(`there are curves without shorter-than-expected outlines`, () => {
    const curve = new Bezier(0, 0, 1, 1, 0, 1, 0, 0.5)
    const outline = curve.outline(0.1)

    assert.ok(!hasShortOutline(curve, outline))
})