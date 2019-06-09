import Bezier from 'bezier-js'
import Nanobus = require('nanobus')
import * as lodash from 'lodash'

type Track = Array<TrackSection>

/**
 * Algorithm
 *
 * generate the first track section
 * - generate a curve without self-intersections
 *   - MAYBE TODO: Make sure none of the control points are too close to the end point they go with, to make weird behavior less likely. Maybe make sure _no_ points are too close to each other.
 * - generate its outline curve for a particular outline distance
 * - make sure the outline curve has no self-intersecions, and no intersections with the original curve
 * - make sure the distance between the offset curve and original curve is never less than 0.8 times the specified offset distance
 * - find the end caps by finding the curves with _linear = true
 *   - Make sure no end of the end cap is too close to the original curve
 *   - discard the end caps
 *
 * generate subsequent track sections
 * - make sure the next section continues smoothly from the previous one
 *   - it should start at the end point of the previous section
 *   - its first control point should lie along the line tangent to the end of the previous curve
 * - make sure there are no intersections with any existing track sections
 * - if there are intersections, try again up to X times
 * - if after X tries there are still intersections, throw away the previous track section, too
 *
 * TODO
 * - add little people that scream when they crash
 */

const trackWidth = 0.1
const curveIntersectionThreshold = 0.001
const emitter = new Nanobus()
const xMinimum = 0
const xMaximum = 1
const yMinimum = 0
const yMaximum = 1
const maximumDistanceBetweenTwoCurveDefinitionPoints = Math.sqrt((xMaximum - xMinimum) ** 2 + (yMaximum - yMinimum) ** 2)
const helpers = {
    points: {
        add,
        multiply,
        invert,
        getLength,
        scaleLength,
    }
}

emitter.on('*', console.log.bind(console, 'event:'))

export {
    makeTrack,
    Track,
    getRandomTrackSection,
    emitter,
    helpers,
}

interface TrackSection {
    center: Bezier,
    leftEdge: Array<Bezier>,
    rightEdge: Array<Bezier>,
}

/** Definition of a cubic bezier curve */
interface BezierCurveDefinition {
    start: Point,
    control1: Point,
    control2: Point,
    end: Point
}

interface Point {
    x: number,
    y: number
}

function makeTrack(requestedSections = 5): Track {
    if (!Number.isInteger(requestedSections)) {
        throw new Error(`The number of sections must be an integer`)
    }

    if (requestedSections < 1) {
        throw new Error(`There must be at least one section`)
    }
    
    const sections = [
        getRandomTrackSection()
    ]
    
    while (sections.length < requestedSections) {
        sections.push(getRandomTrackSection({
            previousSection: sections[sections.length - 1]
        }))
    }
    
    return sections
}

function getRandomTrackSection({
    previousSection
}: {
    previousSection?: TrackSection
} = {}): TrackSection {
    const args = Array.from(arguments)
    const retry = () => getRandomTrackSection(...args)
    const boundingBoxOrigin: Point = previousSection ? add(invert(getRandomPoint()), endOfCenterLine(previousSection)): { x: xMinimum, y: yMinimum }
    const startingPoint = previousSection ? endOfCenterLine(previousSection) : getRandomPoint({ relativeTo: boundingBoxOrigin })
    const firstControlPoint = previousSection ? randomPointAlongEndOfCenterLineTangent(previousSection) : getRandomPoint({ relativeTo: boundingBoxOrigin })
    
    console.debug(`Generating random track section with bounding box origin ${JSON.stringify(boundingBoxOrigin)}, starting point ${JSON.stringify(startingPoint)}, and first control point ${JSON.stringify(firstControlPoint)}`)

    const centerLine = new Bezier([
        startingPoint,
        firstControlPoint,
        getRandomPoint({ relativeTo: boundingBoxOrigin }),  // second control point
        getRandomPoint({ relativeTo: boundingBoxOrigin }),  // ending point
    ])

    if (centerLine.selfintersects(curveIntersectionThreshold).length > 0) {
        console.log('Center line intersects itself... retrying')

        return retry()
    }

    const outlineCurves = centerLine.outline(trackWidth / 2).curves
    const endCapIndexes: Array<number> = []
    const endCaps = outlineCurves.filter((curve, index) => {
        if (isProbablyEndCap(curve)) {
            endCapIndexes.push(index)
            return true
        }
    })


    if (endCaps.length !== 2) {
        console.log(`Did not find exactly 2 probable end caps... retrying`)

        return retry()
    }

    if (endCaps.some(cap => endpointIsTooCloseToCurve(cap, centerLine))) {
        console.log(`End cap endpoint is too close to the centerline. This can indicate tight curvature at the end of the path. Retrying.`)

        return retry()
    }

    // split the left and right edges. An end cap comes first, followed by the left edge, followed by the second end cap, followed by the right edge

    if (endCapIndexes[0] !== 0) {
        throw new Error('The assumptions about end cap indexes are incorrect and the code needs to be updated')
    }

    const leftEdge = outlineCurves.slice(endCapIndexes[0] + 1, endCapIndexes[1])
    const rightEdge = outlineCurves.slice(endCapIndexes[1] + 1)

    if (hasAnySelfIntersections([centerLine, ...leftEdge, ...rightEdge])) {
        console.log(`Found self-intersections in the outline curve... retrying`)

        return retry()
    }

    return {
        center: centerLine,
        leftEdge,
        rightEdge,
    }
}

function endOfCenterLine(section: TrackSection): Point {
    return section.center.get(1)
}

function randomPointAlongEndOfCenterLineTangent(section: TrackSection): Point {
    const endPoint = endOfCenterLine(section)
    const tangent = section.center.derivative(1)
    const distanceAlongTangent = lodash.random(0, maximumDistanceBetweenTwoCurveDefinitionPoints, true)

    return add(endPoint, scaleLength(tangent, distanceAlongTangent))
}

const minimumAcceptableCapEndpointDistance = 0.99 * (trackWidth / 2)
function endpointIsTooCloseToCurve(curveToCheckEndpoints: Bezier, curveToStayAwayFrom: Bezier): boolean {
    if (curveToStayAwayFrom.project(curveToCheckEndpoints.points[0]).d < minimumAcceptableCapEndpointDistance) {
        return true
    }

    if (curveToStayAwayFrom.project(curveToCheckEndpoints.points[3]).d < minimumAcceptableCapEndpointDistance) {
        return true
    }

    return false
}

function hasAnySelfIntersections(curves: ReadonlyArray<Bezier>): boolean {
    for (let firstCurveIndex = 0; firstCurveIndex < curves.length - 1; firstCurveIndex += 1) {
        for (let secondCurveIndex = firstCurveIndex; secondCurveIndex < curves.length; secondCurveIndex += 1) {  // start from the same index so that self-intersection checks happen
            if (hasIntersectionOtherThanAtCurveEnds(curves[firstCurveIndex], curves[secondCurveIndex])) {
                return true
            }
        }
    }

    return false
}

function hasIntersectionOtherThanAtCurveEnds(curve1: Bezier, curve2: Bezier): boolean {
    if (curve1 === curve2) {
        // check for self-intersections instead of intersections with the other curve
        return curve1.selfintersects(curveIntersectionThreshold).length > 0
    }

    if (!curve1.overlaps(curve2)) {
        return false
    }

    const intersections = curve1.intersects(curve2, curveIntersectionThreshold) as Array<string> // these strings are of the form "t1/t2" where t1 is the t-value of the intersection on the first curve and t2 is the t-value on the second curve

    if (intersections.length === 0) {
        return false
    }

    return intersections.some(intersection => {
        const [
            t1,
            t2,
        ] = intersection.split('/').map(string => Number(string))

        const isAwayFromEnds = (t1 > 0.01 && t1 < 0.99) || (t2 > 0.01 && t2 < 0.99)

        return isAwayFromEnds
    })
}

function isProbablyEndCap(curve: Bezier): boolean {
    const length = curve.length()

    return curve._linear && length > (0.95 * trackWidth) && length < (1.05 * trackWidth)
}

function getRandomPoint({
    relativeTo = { x: xMinimum, y: yMinimum },
}: {
    relativeTo?: Point
} = {}): Point {
    return add(relativeTo, {
        x: lodash.random(xMinimum, xMaximum, true),
        y: lodash.random(yMinimum, yMaximum, true),
    })
}

function getLength({ x, y }: Point): number {
    return Math.sqrt(x ** 2 + y ** 2)
}

function scaleLength({ x, y }: Point, newLength: number): Point {
    const currentLength = Math.sqrt(x ** 2 + y ** 2)
    const scaleFactor = newLength / currentLength

    return {
        x: scaleFactor * x,
        y: scaleFactor * y,
    }
}

function multiply(point: Point, multiple: number): Point {
    return {
        x: point.x * multiple,
        y: point.y * multiple,
    }
}

function add(point1: Point, point2: Point): Point {
    return {
        x: point1.x + point2.x,
        y: point1.y + point2.y,
    }
}

function invert(point: Point): Point {
    return {
        x: -point.x,
        y: -point.y,
    }
}