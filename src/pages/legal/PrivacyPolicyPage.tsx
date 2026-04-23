import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { LEGAL_VERSIONS } from '@/legal/versions';

export function PrivacyPolicyPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline mb-6"
        >
          <ArrowLeft size={16} />
          Back
        </button>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-10 space-y-8">
          <header>
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-1">First Whistle</p>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
            <p className="text-sm text-gray-500">
              Effective Date: {LEGAL_VERSIONS.effectiveDate} &mdash; Last Updated: {LEGAL_VERSIONS.effectiveDate}
            </p>
          </header>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">Introduction</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              First Whistle (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) is a sports scheduling and team management platform built
              for youth and adult leagues. We take your privacy &mdash; and especially the privacy of children &mdash; seriously.
              This Privacy Policy explains what information we collect, how we use it, who we share it with, and what rights
              you have over your data.
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">
              This policy applies to all users of First Whistle, including coaches, league managers, parents, and players.
              If you are a parent or guardian of a child using this platform, please read this policy carefully, particularly
              the <strong>Children&rsquo;s Privacy</strong> section.
            </p>
            <p className="text-sm text-gray-700">
              If you have questions, contact us at{' '}
              <a href="mailto:legal@firstwhistle.com" className="text-blue-600 hover:underline">legal@firstwhistle.com</a>.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">1. Who This Policy Covers</h2>
            <p className="text-sm text-gray-700 leading-relaxed">This policy applies to:</p>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
              <li><strong>Coaches and team staff</strong> &mdash; adults who create accounts and manage teams</li>
              <li><strong>League managers and administrators</strong> &mdash; adults who manage league-level operations</li>
              <li><strong>Parents and guardians</strong> &mdash; adults who consent on behalf of minor players</li>
              <li><strong>Adult players</strong> &mdash; players age 18 and over who hold their own accounts</li>
              <li><strong>Minor players</strong> &mdash; players under 18 whose profiles are created and managed by a coach, admin, or parent</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">2. What Information We Collect</h2>

            <h3 className="text-base font-semibold text-gray-800">2.1 Account Information</h3>
            <p className="text-sm text-gray-700">When you register for a First Whistle account, we collect:</p>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
              <li>Full name</li>
              <li>Email address</li>
              <li>Password (stored in encrypted form via Firebase Authentication)</li>
              <li>Role (coach, league manager, parent, or player)</li>
              <li>Phone number (optional at registration; may be required for SMS notifications)</li>
            </ul>

            <h3 className="text-base font-semibold text-gray-800">2.2 Player Profile Information</h3>
            <p className="text-sm text-gray-700">When a coach or administrator creates a player profile, the following information may be entered:</p>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
              <li>Player&rsquo;s full name</li>
              <li>Date of birth or age</li>
              <li>Jersey number or position (optional)</li>
              <li>Parent or guardian name(s), email address(es), and phone number(s)</li>
              <li>Team and league affiliation</li>
            </ul>

            <h3 className="text-base font-semibold text-gray-800">2.3 Attendance and Participation Records</h3>
            <p className="text-sm text-gray-700">
              We collect RSVP responses, attendance check-ins or check-outs, and participation history tied to a player&rsquo;s profile.
            </p>

            <h3 className="text-base font-semibold text-gray-800">2.4 Communications Data</h3>
            <p className="text-sm text-gray-700">
              When you use First Whistle&rsquo;s messaging and notification features, we may store messages sent through the platform,
              email and SMS notification content and delivery status, and announcement history associated with a team or league.
            </p>

            <h3 className="text-base font-semibold text-gray-800">2.5 Photos (Future Feature)</h3>
            <p className="text-sm text-gray-700">
              <strong>No photos are collected at this time.</strong> When photo collection is introduced in a future release,
              photos of minor players will require parental consent before upload and parents may request removal at any time.
            </p>

            <h3 className="text-base font-semibold text-gray-800">2.6 Usage and Technical Data</h3>
            <p className="text-sm text-gray-700">
              We automatically collect browser type and version, device type and operating system, IP address, pages visited and
              actions taken within the app, and login timestamps. This data is used to maintain and improve the platform and is
              not used to build individual advertising profiles.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">3. How We Use Your Information</h2>
            <p className="text-sm text-gray-700">We use the information we collect to:</p>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
              <li>Provide the service &mdash; create and display schedules, rosters, and team information</li>
              <li>Send notifications &mdash; deliver game reminders, schedule changes, and announcements</li>
              <li>Track attendance &mdash; record RSVPs and participation for coaches and league administrators</li>
              <li>Enable communications &mdash; allow coaches to message parents and players within the platform</li>
              <li>Support account management &mdash; let users log in, update their profiles, and manage team memberships</li>
              <li>Maintain platform security &mdash; detect and prevent unauthorized access or abuse</li>
              <li>Improve the product &mdash; analyze usage patterns to fix bugs and build better features</li>
              <li>Respond to support requests</li>
            </ul>
            <p className="text-sm text-gray-700 font-medium">
              We do not sell your personal information. We do not use your data to serve you third-party advertising.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">4. Children&rsquo;s Privacy &mdash; COPPA Compliance</h2>
            <p className="text-sm text-gray-700">This section applies specifically to players under the age of 13 and their parents or guardians.</p>

            <h3 className="text-base font-semibold text-gray-800">4.1 Our Approach to Children&rsquo;s Data</h3>
            <p className="text-sm text-gray-700 leading-relaxed">
              First Whistle complies with the Children&rsquo;s Online Privacy Protection Act (COPPA). We do not allow children under 13
              to create their own accounts. Player profiles for children under 13 are created and managed by a verified adult &mdash;
              a coach, league administrator, or parent.
            </p>

            <h3 className="text-base font-semibold text-gray-800">4.2 What Data We Hold on Children Under 13</h3>
            <p className="text-sm text-gray-700">A player profile for a child under 13 may contain their name, date of birth or age, jersey number or position (optional), team and league affiliation, and attendance records. <strong>We do not collect</strong> a child&rsquo;s email address, phone number, or login credentials.</p>

            <h3 className="text-base font-semibold text-gray-800">4.3 Parental Consent</h3>
            <p className="text-sm text-gray-700 leading-relaxed">
              By adding a player under 13 to a team, the coach or administrator represents that they have obtained verifiable
              parental or guardian consent. Parents who believe their child&rsquo;s profile was created without their consent
              should contact us immediately at{' '}
              <a href="mailto:legal@firstwhistle.com" className="text-blue-600 hover:underline">legal@firstwhistle.com</a>.
              We will respond to verified parental requests within <strong>30 days</strong>.
            </p>

            <h3 className="text-base font-semibold text-gray-800">4.4 Players Age 13&ndash;17</h3>
            <p className="text-sm text-gray-700">
              Players age 13 through 17 may be added to team rosters. For platform accounts held by users age 13&ndash;17, we
              require parental consent before account activation. Parents may contact us at any time to review, correct, or
              delete their minor child&rsquo;s account.
            </p>

            <h3 className="text-base font-semibold text-gray-800">4.5 How to Submit a Parental Request</h3>
            <p className="text-sm text-gray-700">
              Contact us at{' '}
              <a href="mailto:legal@firstwhistle.com" className="text-blue-600 hover:underline">legal@firstwhistle.com</a>{' '}
              with the subject line &ldquo;Parental Data Request.&rdquo; Please include your name, your child&rsquo;s name and
              team, and the action you are requesting. We may ask you to verify your identity before processing the request.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">5. Third-Party Services</h2>

            <h3 className="text-base font-semibold text-gray-800">5.1 Firebase / Google</h3>
            <p className="text-sm text-gray-700">
              We use Firebase (a Google service) for user authentication, database storage, and application hosting.
              Data stored in Firebase is subject to Google&rsquo;s Privacy Policy. Data may be stored on servers in the United States.
            </p>

            <h3 className="text-base font-semibold text-gray-800">5.2 Email Provider</h3>
            <p className="text-sm text-gray-700">We use a third-party email delivery service to send transactional emails.</p>

            <h3 className="text-base font-semibold text-gray-800">5.3 SMS Provider</h3>
            <p className="text-sm text-gray-700">If SMS notifications are enabled, we use a third-party SMS delivery service.</p>

            <h3 className="text-base font-semibold text-gray-800">5.4 No Advertising Networks</h3>
            <p className="text-sm text-gray-700">
              We do not use advertising networks, analytics platforms that build individual user profiles for advertising, or data brokers.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">6. Data Sharing</h2>
            <p className="text-sm text-gray-700">We do not sell your personal information. We share data only in the following limited circumstances:</p>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
              <li><strong>Within your team or league</strong> &mdash; coaches and league admins can see player roster data for their own team or league only</li>
              <li><strong>With service providers</strong> &mdash; as described in Section 5, solely for delivering the service</li>
              <li><strong>With your consent</strong> &mdash; if you explicitly authorize a specific disclosure</li>
              <li><strong>For legal compliance</strong> &mdash; if required by law, court order, or to protect the safety of users</li>
              <li><strong>In a business transfer</strong> &mdash; if First Whistle is acquired or merges with another entity, user data may be transferred with prior notice</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">7. Data Retention and Deletion</h2>
            <ul className="list-disc list-inside space-y-2 text-sm text-gray-700">
              <li><strong>Active accounts</strong> &mdash; We retain your data for as long as your account is active.</li>
              <li><strong>Account deletion</strong> &mdash; Your personal account information is removed from active systems within <strong>30 days</strong>. Backup copies may persist for up to <strong>90 days</strong> before being purged.</li>
              <li><strong>Player profile deletion</strong> &mdash; The player&rsquo;s profile and associated attendance records are removed within <strong>30 days</strong> of a verified request.</li>
              <li><strong>Organization / league deletion</strong> &mdash; All associated data is permanently removed within <strong>90 days</strong>.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">8. Data Security</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              We implement industry-standard security measures including encrypted data transmission (HTTPS/TLS), encrypted
              password storage via Firebase Authentication, and role-based access controls. No system is completely secure.
              If you believe your account has been compromised, contact us immediately at{' '}
              <a href="mailto:legal@firstwhistle.com" className="text-blue-600 hover:underline">legal@firstwhistle.com</a>.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">9. Your Rights</h2>
            <p className="text-sm text-gray-700">Depending on your location, you may have the following rights regarding your personal data:</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-gray-700 border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 pr-4 font-semibold w-1/4">Right</th>
                    <th className="text-left py-2 font-semibold">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr><td className="py-2 pr-4 font-medium">Access</td><td className="py-2">Request a copy of the personal data we hold about you</td></tr>
                  <tr><td className="py-2 pr-4 font-medium">Correction</td><td className="py-2">Request correction of inaccurate data</td></tr>
                  <tr><td className="py-2 pr-4 font-medium">Deletion</td><td className="py-2">Request that we delete your data</td></tr>
                  <tr><td className="py-2 pr-4 font-medium">Portability</td><td className="py-2">Request your data in a machine-readable format</td></tr>
                  <tr><td className="py-2 pr-4 font-medium">Objection</td><td className="py-2">Object to certain types of processing</td></tr>
                  <tr><td className="py-2 pr-4 font-medium">Withdrawal</td><td className="py-2">Where processing is based on consent, withdraw it at any time</td></tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm text-gray-700">
              To exercise any of these rights, contact us at{' '}
              <a href="mailto:legal@firstwhistle.com" className="text-blue-600 hover:underline">legal@firstwhistle.com</a>.
              We will respond within <strong>30 days</strong>.
            </p>
            <p className="text-sm text-gray-700">
              <strong>California residents (CCPA):</strong> You have the right to know what data we collect, request deletion, and opt out of sale (we do not sell data).
            </p>
            <p className="text-sm text-gray-700">
              <strong>EEA users (GDPR):</strong> We process data on the lawful basis of contract performance and, where required, consent.
              You have the right to lodge a complaint with a supervisory authority.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">10. Cookies and Tracking</h2>
            <p className="text-sm text-gray-700">
              First Whistle uses session cookies and local storage to keep you logged in and maintain application state.
              We do not use third-party tracking cookies for advertising purposes.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">11. Changes to This Policy</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              When we make material changes, we will update the &ldquo;Last Updated&rdquo; date and notify account holders by email
              at least <strong>14 days</strong> before the changes take effect. Continued use after the effective date constitutes acceptance.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">12. Contact Us</h2>
            <p className="text-sm text-gray-700">
              Email:{' '}
              <a href="mailto:legal@firstwhistle.com" className="text-blue-600 hover:underline">legal@firstwhistle.com</a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
