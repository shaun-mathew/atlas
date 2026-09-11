import { expect, test } from '@playwright/test';
import type * as SessionModule from '../src/session';
import type * as ProgressModule from '../src/progress';
import type * as CitiesModule from '../src/cities';
import type { FacetSelection } from '../src/facets';

// Import inside browser callbacks: static imports run in Node, outside the
// application's clock-controlled realm and browser storage.
test('curated city and capital introductions cover the catalogue without repeats or omissions', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-11T12:00:00Z'));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const sessionPath = '/src/session.ts';
    const citiesPath = '/src/cities.ts';
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    const { cities } = await import(citiesPath) as typeof CitiesModule;
    function introductions(scope: 'cities' | 'capitals', learning: 'name-to-location' | 'capital-to-location') {
      const learner = new LearnerSession(null);
      learner.choosePractice({ scope, learning, continent: 'Worldwide', region: 'All regions' });
      const expected = cities.filter(city => scope === 'cities' || city.capital);
      const introduced: string[] = [];
      // Fixed time prevents due reviews; ordinary practice revisits still interleave.
      for (let question = 0; question < expected.length * 3; question++) {
        const city = learner.city!;
        if (learner.questionKind === 'new') introduced.push(city.id);
        learner.answer(city.longitude, city.latitude);
        learner.next();
      }
      return {
        introduced,
        expected: expected.map(city => city.id),
        names: introduced.map(id => cities.find(city => city.id === id)!.name),
      };
    }
    return {
      cities: introductions('cities', 'name-to-location'),
      capitals: introductions('capitals', 'name-to-location'),
      relationships: introductions('capitals', 'capital-to-location'),
    };
  });
  for (const sequence of Object.values(result)) {
    expect([...sequence.introduced].sort()).toEqual([...sequence.expected].sort());
  }
  // Familiar landmarks precede small administrative centres; this is not dataset order.
  expect(result.cities.names.slice(0, 7)).toEqual(['London', 'Tokyo', 'New York City', 'Paris', 'Sydney', 'Cairo', 'Rio de Janeiro']);
  expect(result.cities.names.indexOf('Canberra')).toBeGreaterThan(result.cities.names.indexOf('Sydney'));
  expect(result.cities.names.indexOf('Oranjestad')).toBeGreaterThan(result.cities.names.indexOf('Canberra'));
  // Named capitals inherit city familiarity, but relationship recall has its own opening.
  expect(result.capitals.names.indexOf('Cape Town')).toBeLessThan(result.capitals.names.indexOf('Washington'));
  expect(result.relationships.names.indexOf('Washington')).toBeLessThan(result.relationships.names.indexOf('Cape Town'));
  expect(result.relationships.names.indexOf('Canberra')).toBeGreaterThan(result.relationships.names.indexOf('Paris'));
});

test('geographic filters keep familiar local introductions and respect capital scope', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const sessionPath = '/src/session.ts';
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    function first(selection: FacetSelection) {
      const learner = new LearnerSession(null);
      learner.choosePractice(selection);
      return { name: learner.city!.name, capital: learner.city!.capital, region: learner.country!.properties.region };
    }
    return {
      africa: first({ scope: 'cities', continent: 'Africa', region: 'All regions', learning: 'name-to-location' }),
      southernAfrica: first({ scope: 'cities', continent: 'Africa', region: 'Southern Africa', learning: 'name-to-location' }),
      northAmerica: first({ scope: 'cities', continent: 'North America', region: 'Northern America', learning: 'name-to-location' }),
      northAmericanCapitals: first({ scope: 'capitals', continent: 'North America', region: 'Northern America', learning: 'name-to-location' }),
      southernCapitalRelationships: first({ scope: 'capitals', continent: 'Africa', region: 'Southern Africa', learning: 'capital-to-location' }),
    };
  });
  expect(result.africa.name).toBe('Cairo');
  expect(result.southernAfrica).toEqual({ name: 'Cape Town', capital: true, region: 'Southern Africa' });
  expect(result.northAmerica.name).toBe('New York City');
  expect(result.northAmericanCapitals).toEqual({ name: 'Washington', capital: true, region: 'Northern America' });
  expect(result.southernCapitalRelationships).toEqual({ name: 'Pretoria', capital: true, region: 'Southern Africa' });
});

test('curated introductions preserve old pending cities and defer to their due reviews', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-11T12:00:00Z'));
  await page.goto('/');
  const learner = await page.evaluateHandle(async () => {
    const sessionPath = '/src/session.ts';
    const citiesPath = '/src/cities.ts';
    const progressPath = '/src/progress.ts';
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    const { cities } = await import(citiesPath) as typeof CitiesModule;
    const { initialProgress } = await import(progressPath) as typeof ProgressModule;
    // A pre-curation save may already have introduced the old first city.
    const city = cities.find(city => city.name === 'Oranjestad')!;
    const saved = initialProgress();
    saved.started = true;
    saved.selection = { scope: 'cities', continent: 'Worldwide', region: 'All regions', learning: 'name-to-location' };
    saved.current = { countryId: city.countryId, cityId: city.id, skill: 'name-to-location', kind: 'new', assisted: true };
    return new LearnerSession(null, saved);
  });
  expect(await learner.evaluate(session => ({ name: session.city!.name, assisted: session.assisted })))
    .toEqual({ name: 'Oranjestad', assisted: true });
  const saved = await learner.evaluate(session => {
    session.answer(session.city!.longitude, session.city!.latitude);
    return { progress: session.snapshot(), proficiency: session.proficiency! };
  });
  await page.clock.setFixedTime(new Date(saved.proficiency.dueAt));
  const restored = await page.evaluateHandle(async progress => {
    const sessionPath = '/src/session.ts';
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    return new LearnerSession(null, progress);
  }, saved.progress);
  expect(await restored.evaluate(session => session.proficiency)).toEqual(saved.proficiency);
  expect(await restored.evaluate(session => session.attempts)).toEqual(saved.progress.attempts);
  expect(await restored.evaluate(session => {
    session.next();
    return { name: session.city!.name, kind: session.questionKind };
  })).toEqual({ name: 'Oranjestad', kind: 'review' });
  expect(await restored.evaluate(session => {
    session.answer(session.city!.longitude, session.city!.latitude);
    session.next();
    return { name: session.city!.name, kind: session.questionKind };
  })).toEqual({ name: 'London', kind: 'new' });
});

test('city scoring uses distance rather than its country boundary and keeps retry review dates', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-11T12:00:00Z'));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const sessionPath = '/src/session.ts';
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    const learner = new LearnerSession(null);
    learner.choosePractice({ scope: 'cities', continent: 'Worldwide', region: 'All regions', learning: 'name-to-location' });
    const city = learner.city!;
    const original = learner.snapshot();
    const north = (km: number) => city.latitude + km / 6371 * 180 / Math.PI;
    learner.answer(city.longitude, north(24.9));
    const accepted = learner.feedback!.correct;
    learner.replace(original);
    learner.answer(city.longitude, north(25.1));
    const rejected = !learner.feedback!.correct;
    const due = learner.proficiency!.dueAt;
    learner.retry();
    learner.answer(city.longitude, city.latitude);
    return { accepted, rejected, retryCity: learner.city!.id, cityId: city.id, retryCorrect: learner.feedback!.correct, due, retryDue: learner.proficiency!.dueAt };
  });
  expect(result.accepted).toBe(true);
  expect(result.rejected).toBe(true);
  expect(result.retryCity).toBe(result.cityId);
  expect(result.retryCorrect).toBe(true);
  expect(result.retryDue).toBe(result.due);
});

test('capital, named-city and country proficiency remain separate after merging and restoring', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-11T12:00:00Z'));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const sessionPath = '/src/session.ts';
    const progressPath = '/src/progress.ts';
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    const { initialProgress, mergeProgress } = await import(progressPath) as typeof ProgressModule;
    const learner = new LearnerSession(null);
    const selection = { scope: 'capitals', continent: 'Worldwide', region: 'All regions', learning: 'name-to-location' } as const;
    learner.choosePractice(selection);
    const city = learner.city!;
    learner.answer(city.longitude, city.latitude);
    const namedDue = learner.proficiency!.dueAt;
    const named = learner.snapshot();
    learner.choosePractice({ ...selection, learning: 'capital-to-location' });
    const capital = learner.snapshot();
    capital.current = { countryId: city.countryId, cityId: city.id, skill: 'capital-to-location', kind: 'new', assisted: false };
    learner.replace(capital);
    const capitalUnlearned = learner.proficiency === undefined;
    learner.answer(((city.longitude + 360) % 360) - 180, -city.latitude);
    const capitalDue = learner.proficiency!.dueAt;
    const restored = new LearnerSession(null, mergeProgress(named, learner.snapshot()));
    const restoredCapitalDue = restored.proficiency!.dueAt;
    const countryState = initialProgress();
    countryState.started = true;
    countryState.current = { countryId: city.countryId, skill: 'name-to-location', kind: 'new', assisted: false };
    const country = new LearnerSession(null, mergeProgress(restored.snapshot(), countryState));
    const countryUnlearned = country.proficiency === undefined;
    restored.choosePractice(selection);
    const namedAgain = restored.snapshot();
    namedAgain.current = { countryId: city.countryId, cityId: city.id, skill: 'name-to-location', kind: 'practice', assisted: false };
    restored.replace(namedAgain);
    return { capitalUnlearned, countryUnlearned, namedDue, capitalDue, restoredCapitalDue, restoredNamedDue: restored.proficiency!.dueAt };
  });
  expect(result.capitalUnlearned).toBe(true);
  expect(result.countryUnlearned).toBe(true);
  expect(result.capitalDue).not.toBe(result.namedDue);
  expect(result.restoredCapitalDue).toBe(result.capitalDue);
  expect(result.restoredNamedDue).toBe(result.namedDue);
});

test('city assistance survives skill switching and conflicting city history is rejected', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const sessionPath = '/src/session.ts';
    const progressPath = '/src/progress.ts';
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    const { mergeProgress, ProgressConflictError } = await import(progressPath) as typeof ProgressModule;
    const learner = new LearnerSession(null);
    const selection = { scope: 'capitals', continent: 'Worldwide', region: 'All regions', learning: 'name-to-location' } as const;
    learner.choosePractice(selection);
    const city = learner.city!;
    learner.requestLocationHelp();
    learner.choosePractice({ ...selection, learning: 'capital-to-location' });
    const helped = learner.city?.id === city.id && learner.assisted;
    learner.answer(city.longitude, city.latitude);
    const saved = learner.snapshot();
    const restored = new LearnerSession(null, mergeProgress(saved, saved));
    const conflict = structuredClone(saved);
    // Distance is durable assessment evidence even if both versions score correctly.
    conflict.attempts[0].distanceKm = 1;
    let conflictRejected = false;
    try { mergeProgress(saved, conflict); } catch (error) { conflictRejected = error instanceof ProgressConflictError; }
    return { helped, restoredAssisted: restored.feedback!.assisted, level: restored.proficiency!.level, conflictRejected };
  });
  expect(result.helped).toBe(true);
  expect(result.restoredAssisted).toBe(true);
  expect(result.level).toBe('Learning');
  expect(result.conflictRejected).toBe(true);
});

test('city imagery stays visible from world overview to detail on both presentations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Distinct raster colours make the rendered basemap observable without
  // depending on external imagery availability or its changing pixels.
  const tiles = await page.evaluate(() => ['#e020e0', '#20e0e0'].map(colour => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d')!;
    context.fillStyle = colour;
    context.fillRect(0, 0, 256, 256);
    return canvas.toDataURL().split(',')[1];
  }));
  await page.route(/gibs\.earthdata\.nasa\.gov\/wmts|wmts\.terrascope\.be\/wmts/, route =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(tiles[route.request().url().includes('gibs.earthdata') ? 0 : 1], 'base64'),
    }));
  await page.goto('/');
  await page.locator('#change-quiz').click();
  await page.getByRole('button', { name: /^National capitals/ }).click();

  async function basemapColour(selector: string) {
    const box = (await page.locator(selector).boundingBox())!;
    const image = await page.screenshot({ clip: {
      x: box.x + box.width / 2 + 20, y: box.y + box.height / 2 + 20, width: 1, height: 1,
    } });
    return page.evaluate(async base64 => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return r > g * 1.5 && b > g * 1.5 ? 'overview'
        : g > r * 1.5 && b > r * 1.5 ? 'detail' : 'plain';
    }, image.toString('base64'));
  }

  await expect.poll(() => basemapColour('#map')).toBe('overview');
  await page.getByRole('button', { name: 'Show location', exact: true }).click();
  await expect.poll(() => basemapColour('#map')).toBe('detail');
  await page.getByRole('button', { name: 'World view', exact: true }).click();
  await expect.poll(() => basemapColour('#map')).toBe('overview');
  await page.getByRole('button', { name: 'Switch to 3D globe', exact: true }).click();
  await page.getByRole('button', { name: 'World view', exact: true }).click();
  await expect.poll(() => basemapColour('#globe canvas')).toBe('overview');
  for (let step = 0; step < 16; step++) {
    await page.getByRole('button', { name: 'Zoom in on globe' }).click();
  }
  await expect.poll(() => basemapColour('#globe canvas')).toBe('detail');
  await page.getByRole('button', { name: 'World view', exact: true }).click();
  await expect.poll(() => basemapColour('#globe canvas')).toBe('overview');
  await page.locator('#change-quiz').click();
  await page.getByRole('button', { name: /^Countries & territories/ }).click();
  await expect.poll(() => basemapColour('#globe canvas')).toBe('plain');
  await page.getByRole('button', { name: 'Switch to 2D map', exact: true }).click();
  await expect.poll(() => basemapColour('#map')).toBe('plain');
});
