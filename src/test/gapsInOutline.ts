import Bezier from 'bezier-js'
import test from 'parallel-test'
import {
    hasGapsInOutline,
    helpers,
} from '../index'
import * as assert from 'assert'

function getGaps(curves: ReadonlyArray<Bezier>): ReadonlyArray<number> {
    const segmentGaps: Array<number> = []

    for (let i = 1; i < curves.length; i += 1) {
        const previousCurve = curves[i - 1]
        const previousCurveEndPoint = previousCurve.get(1)
        const curve = curves[i]
        const curveStartPoint = curve.get(0)

        segmentGaps.push(helpers.points.distance(previousCurveEndPoint, curveStartPoint))
    }

    // include the gap between the start of the first segment and the end of the last segment
    segmentGaps.push(helpers.points.distance(
        curves[0].get(0),
        curves[curves.length - 1].get(1),
    ))

    return segmentGaps
}

test(`The error case can be reproduced by creating a curve with caps in its outline`, () => {
    /**
     * two gaps in the outline were identified while observing drawn curves in the browser for this randomly-generated curve using these parameters
     */

    const curve = new Bezier([
        {"x":-6.269852257294678,"y":-1.1923252053424367},
        {"x":-6.978661322855596,"y":-1.7831640797865094},
        {"x":-6.315565070854568,"y":-0.620476701373424},
        {"x":-6.941598744089967,"y":-0.5133002280304251}
    ])
    const outline = curve.outline(0.1 / 2)
    const segmentGaps = getGaps(outline.curves)

    assert.ok(segmentGaps.filter(gapSize => gapSize > 0.001).length === 2)
    assert.ok(hasGapsInOutline(outline.curves))
})

test(`There are curves without gaps in their outlines`, () => {
    const curve = new Bezier(0, 0, 1, 1, 0, 1, 0, 0.5)
    const outline = curve.outline(0.1)

    assert.ok(getGaps(outline.curves).every(gapSize => gapSize < 0.001))
    assert.ok(!hasGapsInOutline(outline.curves))
})