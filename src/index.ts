import Bezier from 'bezier-js'
import Nanobus = require('nanobus')
import * as lodash from 'lodash'

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
 * - handle errors
 *   - Uncaught (in promise) Error: cannot scale this curve. Try reducing it first.
    at Bezier.scale (bezier.js:637)
    at bezier.js:722
    at Array.forEach (<anonymous>)
    at Bezier.outline (bezier.js:712)
    at getRandomTrackSection (index.js:167)
    at Object.<anonymous> (index.js:129)
    at step (index.js:32)
    at Object.next (index.js:13)
    at fulfilled (index.js:4)
 * - Check if the end point of a track section is mostly-enclosed. If it is, remake it.
 *   - It could work to project a bunch of long lines in random directions. If more than X% of them hit an existing piece of track, then consider the point to be mostly enclosed
 * - Rather than making a whole next track piece, make just its next center line, check for collisions with existing segments, and then outline it if the center doesn't collide.
 */

const minimumTrackWidth = 0.05
const maximumTrackWidth = 0.5
const curveIntersectionThreshold = 0.001
const maximumAllowedOutlineGap = 0.0001
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
        distance,
    }
}

emitter.on('*', console.debug.bind(console, 'event:'))

export {
    makeTrack,
    Track,
    getRandomTrackSection,
    emitter,
    helpers,
    hasGapsInOutline,
}

type Track = Array<TrackSection>

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

const maximumTriesPerSection = 3
async function makeTrack(requestedSections = 5): Promise<Track> {
    const trackWidth = lodash.random(minimumTrackWidth, maximumTrackWidth, true)
    console.log(`Track width:`, trackWidth)

    const sections = [
        getRandomTrackSection({ trackWidth })
    ]
    const triesBySection: Array<number> = [1]

    let tries = 0

    emitter.emit('sectionsSoFar', sections)
    await minimalDelay()

    while (sections.length < requestedSections) {
        const currentSectionIndex = sections.length

        if (triesBySection[currentSectionIndex] > maximumTriesPerSection) {
            console.log(`The previous section is difficult to build off of. Removing it and trying again`)

            sections.pop()
            triesBySection[currentSectionIndex] = 0
            triesBySection[currentSectionIndex - 1] += 1

            emitter.emit('sectionsSoFar', sections)
            await minimalDelay()

            continue
        }

        const nextSection = getRandomTrackSection({ previousSection: sections[currentSectionIndex - 1], allPreviousSections: sections, trackWidth })

        emitter.emit('sectionsSoFar', [...sections, nextSection])

        await minimalDelay()  // to give consumers of the emitter a chance to do something

        triesBySection[currentSectionIndex] = (triesBySection[currentSectionIndex] || 0) + 1
        console.debug(`triesBySection`, triesBySection)

        if (hasAnySelfIntersections(getAllCurves([nextSection]), getAllCurves(sections))) {
            console.log(`The next track section intersects the previous ones... retrying`)
            continue
        }

        sections.push(nextSection)
    }

    return sections
}

function minimalDelay(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

function getRandomTrackSection({
    previousSection,
    allPreviousSections = [],
    trackWidth,
}: {
    previousSection?: TrackSection
    allPreviousSections?: Track,
    trackWidth: number
}): TrackSection {
    const args = Array.from(arguments) as Parameters<typeof getRandomTrackSection>
    const retry = () => getRandomTrackSection(...args)
    const boundingBoxOrigin: Point = previousSection ? add(invert(getRandomPoint()), endOfCenterLine(previousSection)): { x: xMinimum, y: yMinimum }
    const startingPoint = previousSection ? endOfCenterLine(previousSection) : getRandomPoint({ relativeTo: boundingBoxOrigin })
    const firstControlPoint = previousSection ? randomPointAlongEndOfCenterLineTangent(previousSection) : getRandomPoint({ relativeTo: boundingBoxOrigin })
    const secondControlPoint = getRandomPoint({ relativeTo: boundingBoxOrigin })
    const endingPoint = getRandomPoint({ relativeTo: boundingBoxOrigin })

    console.debug(`Generating random track section with bounding box origin ${JSON.stringify(boundingBoxOrigin)}, starting point ${JSON.stringify(startingPoint)}, and first control point ${JSON.stringify(firstControlPoint)}`)

    if (isMostlyEnclosed(endingPoint, allPreviousSections)) {
        console.log(`End point of random section is mostly enclosed, so it'll be difficult to find a way out... retrying`)

        return retry()
    }

    const centerLine = new Bezier([
        startingPoint,
        firstControlPoint,
        secondControlPoint,
        endingPoint,
    ])

    if (centerLine.selfintersects(curveIntersectionThreshold).length > 0) {
        console.log('Center line intersects itself... retrying')

        return retry()
    }

    const outlineCurves = centerLine.outline(trackWidth / 2).curves
    const endCapIndexes: Array<number> = []
    const endCaps = outlineCurves.filter((curve, index) => {
        if (isProbablyEndCap(curve, trackWidth)) {
            endCapIndexes.push(index)
            return true
        }
    })


    if (endCaps.length !== 2) {
        console.log(`Did not find exactly 2 probable end caps... retrying`)

        return retry()
    }

    if (endCaps.some(cap => endpointIsTooCloseToCurve(cap, centerLine, trackWidth))) {
        console.log(`End cap endpoint is too close to the centerline. This can indicate tight curvature at the end of the path. Retrying.`)

        return retry()
    }

    if (hasGapsInOutline(outlineCurves)) {
        console.log(`There are gaps in the outline... retrying`)

        return retry()
    }

    // split the left and right edges. An end cap comes first, followed by the left edge, followed by the second end cap, followed by the right edge

    if (endCapIndexes[0] !== 0) {
        throw new Error('The assumptions about end cap indexes are incorrect and the code needs to be updated')
    }

    const rightEdge = outlineCurves.slice(endCapIndexes[0] + 1, endCapIndexes[1])
    const leftEdge = outlineCurves.slice(endCapIndexes[1] + 1)

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

const numberOfLines = 10
const lineLength = 50
const linesInAllDirectionsFromOrigin: Array<BezierJs.Line> = lodash.range(numberOfLines).map(lineNumber => ({
    p1: {
        x: 0,
        y: 0,
    },
    p2: {
        x: Math.cos(Math.PI * 2 * lineNumber / numberOfLines) * lineLength,
        y: Math.sin(Math.PI * 2 * lineNumber / numberOfLines) * lineLength,
    }
}))
function isMostlyEnclosed(point: Point, existingSections: Track): boolean {
    if (existingSections.length === 0) {
        return false
    }

    let directionsWithIntersections = 0
    const centerLines = existingSections.map(section => section.center)

    for (const line of linesInAllDirectionsFromOrigin) {
        const lineTranslatedToPoint: BezierJs.Line = {
            p1: point,
            p2: add(point, line.p2)
        }

        // go in reverse, since it's more likely that more recent sections enclose this point
        for (let existingCurveIndex = centerLines.length - 1; existingCurveIndex >= 0; existingCurveIndex -= 1) {
            if (centerLines[existingCurveIndex].lineIntersects(lineTranslatedToPoint).length > 0) {
                directionsWithIntersections += 1

                if (directionsWithIntersections / numberOfLines > 0.6) {
                    return true
                }

                break
            }
        }
    }

    return false
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

function endpointIsTooCloseToCurve(curveToCheckEndpoints: Bezier, curveToStayAwayFrom: Bezier, trackWidth: number): boolean {
    const minimumAcceptableCapEndpointDistance = 0.99 * (trackWidth / 2)

    if (curveToStayAwayFrom.project(curveToCheckEndpoints.points[0]).d < minimumAcceptableCapEndpointDistance) {
        return true
    }

    if (curveToStayAwayFrom.project(curveToCheckEndpoints.points[3]).d < minimumAcceptableCapEndpointDistance) {
        return true
    }

    return false
}

/** Assumes that outline curves are sequential and make a loop around the center line */
function hasGapsInOutline(curves: ReadonlyArray<Bezier>): boolean {
    for (let i = 1; i < curves.length; i += 1) {
        const previousCurve = curves[i - 1]
        const previousCurveEndPoint = previousCurve.get(1)
        const curve = curves[i]
        const curveStartPoint = curve.get(0)

        if (distance(previousCurveEndPoint, curveStartPoint) > maximumAllowedOutlineGap) {
            return true
        }
    }

    // include the gap between the start of the first segment and the end of the last segment
    if (distance(curves[0].get(0), curves[curves.length - 1].get(1)) > maximumAllowedOutlineGap) {
        return true
    }

    return false
}

/** If existing curves are provided, they won't be checked for self-intersections. They'll only be checked for intersections with new curves */
function hasAnySelfIntersections(curves: ReadonlyArray<Bezier>, existingCurves: ReadonlyArray<Bezier> = []): boolean {
    for (let firstCurveIndex = 0; firstCurveIndex < curves.length - 1; firstCurveIndex += 1) {
        // find self-intersections in new curves
        for (let secondCurveIndex = firstCurveIndex; secondCurveIndex < curves.length; secondCurveIndex += 1) {  // start from the same index so that self-intersection checks happen
            if (hasIntersectionOtherThanAtCurveEnds(curves[firstCurveIndex], curves[secondCurveIndex])) {
                return true
            }
        }

        // find intersections between new curves and existing curves
        for (let existingCurveIndex = 0; existingCurveIndex < existingCurves.length; existingCurveIndex += 1) {
            if (hasIntersectionOtherThanAtCurveEnds(curves[firstCurveIndex], existingCurves[existingCurveIndex])) {
                return true
            }
        }
    }

    // find intersections between new curves and existing curves


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

function getAllCurves(track: Track): ReadonlyArray<Bezier> {
    return track.flatMap(section => [
        section.center,
        ...section.leftEdge,
        ...section.rightEdge,
    ])
}

function isProbablyEndCap(curve: Bezier, trackWidth: number): boolean {
    const length = curve.length()

    return curve._linear && length > (0.95 * trackWidth) && length < (1.05 * trackWidth)
}

function getRandomPoint({
    relativeTo = { x: xMinimum, y: yMinimum },
}: {
    relativeTo?: Point
} = {}): Point {
    return add(
        relativeTo,
        multiply(
            {
                x: lodash.random(xMinimum, xMaximum, true),
                y: lodash.random(yMinimum, yMaximum, true),
            },
            lodash.random(0.5, 3, true)
        )
    )
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

function distance(point1: Point, point2: Point): number {
    return getLength(
        add(
            point1,
            invert(point2),
        ),
    )
}